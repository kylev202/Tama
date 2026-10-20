//! Lyrics from LRCLIB (lrclib.net), the one thing Tama looks up online. Only the song's
//! title, artist, album and length are sent. Answers are cached on disk, so a song you
//! play again never goes online again.

use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use windows::core::HSTRING;
use windows::Foundation::Uri;
use windows::Web::Http::HttpClient;

const API: &str = "https://lrclib.net/api";
const USER_AGENT: &str = concat!("Tama/", env!("CARGO_PKG_VERSION"), " (Windows dynamic island)");
/// A "no lyrics" answer is trusted for this long before asking again; LRCLIB keeps growing.
const MISSING_TTL_MS: u64 = 3 * 24 * 60 * 60 * 1000;
/// Every request for one song together gets this long.
const DEADLINE: Duration = Duration::from_secs(12);
/// Synced lyrics from a recording this much longer or shorter would drift out of time.
const DURATION_SLACK: f64 = 3.0;

type Reply<T> = Result<T, String>;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// LRC text (`[mm:ss.xx] line`), parsed by the frontend.
    synced: Option<String>,
    plain: Option<String>,
    instrumental: bool,
    /// Unix ms, so a cached "not found" can expire.
    fetched_at: u64,
}

impl Lyrics {
    fn found(&self) -> bool {
        self.instrumental || self.synced.is_some() || self.plain.is_some()
    }
}

/// One LRCLIB record, as `/api/get` and `/api/search` return it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

impl Record {
    fn into_lyrics(self) -> Lyrics {
        let text = |s: Option<String>| s.filter(|s| !s.trim().is_empty());
        Lyrics {
            synced: text(self.synced_lyrics),
            plain: text(self.plain_lyrics),
            instrumental: self.instrumental,
            fetched_at: now_ms(),
        }
    }
}

/// Lyrics for a song, from the cache or LRCLIB. `duration` is in ms (0 if unknown).
/// A song LRCLIB doesn't know comes back with nothing set; a network failure is an error.
#[tauri::command]
pub async fn lyrics_get(title: String, artist: String, album: String, duration: u64, app: AppHandle) -> Reply<Lyrics> {
    let seconds = (duration as f64 / 1000.0).round();
    let file = cache_dir(&app).map(|dir| dir.join(format!("{:016x}.json", cache_key(&title, &artist, &album, seconds))));
    if let Some(cached) = file.as_ref().and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice::<Lyrics>(&b).ok()) {
        if cached.found() || now_ms().saturating_sub(cached.fetched_at) < MISSING_TTL_MS {
            return Ok(cached);
        }
    }
    let lyrics = tauri::async_runtime::spawn_blocking(move || {
        crate::com::init_mta();
        lookup(&title, &artist, &album, seconds)
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Some(file) = file {
        let _ = std::fs::create_dir_all(file.parent().expect("cache files live in a folder"));
        let _ = std::fs::write(&file, serde_json::to_vec(&lyrics).unwrap_or_default());
    }
    Ok(lyrics)
}

/// The exact match first (LRCLIB needs all four fields for it), then a search that also
/// tries the title without "(Official Video)"-style noise, which browser players add.
fn lookup(title: &str, artist: &str, album: &str, seconds: f64) -> Reply<Lyrics> {
    let client = HttpClient::new().map_err(|e| e.message())?;
    if let Ok(headers) = client.DefaultRequestHeaders() {
        let _ = headers.UserAgent().and_then(|ua| ua.TryParseAdd(&HSTRING::from(USER_AGENT)));
    }
    let deadline = Instant::now() + DEADLINE;

    if !album.is_empty() && seconds > 0.0 {
        let url = query("get", &[("track_name", title), ("artist_name", artist), ("album_name", album), ("duration", &seconds.to_string())])?;
        if let Some(body) = get(&client, &url, deadline)? {
            if let Ok(record) = serde_json::from_str::<Record>(&body) {
                let lyrics = record.into_lyrics();
                if lyrics.found() {
                    return Ok(lyrics);
                }
            }
        }
    }

    let mut attempts = vec![(title.to_string(), artist.to_string())];
    for attempt in tidy(title, artist) {
        if !attempt.0.is_empty() && !attempts.contains(&attempt) {
            attempts.push(attempt);
        }
    }
    for (title, artist) in attempts {
        let url = query("search", &[("track_name", &title), ("artist_name", &artist)])?;
        let Some(body) = get(&client, &url, deadline)? else { continue };
        let records: Vec<Record> = serde_json::from_str(&body).unwrap_or_default();
        if let Some(record) = best(records, seconds) {
            return Ok(record.into_lyrics());
        }
    }
    Ok(Lyrics { fetched_at: now_ms(), ..Lyrics::default() })
}

/// Picks the record that fits this recording: synced lyrics only count when the length
/// matches, since a radio edit or live take would drift out of time.
fn best(records: Vec<Record>, seconds: f64) -> Option<Record> {
    let fits = |r: &Record| seconds <= 0.0 || (r.duration - seconds).abs() <= DURATION_SLACK;
    let rank = |r: &Record| match (fits(r), r.synced_lyrics.is_some(), r.plain_lyrics.is_some() || r.instrumental) {
        (true, true, _) => 3,
        (true, false, true) => 2,
        (false, _, true) | (false, true, _) => 1,
        _ => 0,
    };
    let mut best = records.into_iter().max_by_key(|r| rank(r))?;
    match rank(&best) {
        0 => None,
        // A different recording: its words are right but its timings aren't.
        1 => {
            best.synced_lyrics = None;
            Some(best).filter(|r| r.plain_lyrics.is_some() || r.instrumental)
        }
        _ => Some(best),
    }
}

/// Other ways to read a messy title, best guess first. Browser players publish things like
/// "Daft Punk - Get Lucky (Official Video) [HD]" by "DaftPunkVEVO"; music apps publish
/// "Get Lucky - Radio Edit". Either side of the dash can be the song.
fn tidy(title: &str, artist: &str) -> Vec<(String, String)> {
    let mut bare = String::new();
    let mut depth = 0;
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => bare.push(c),
            _ => {}
        }
    }
    let bare = without_featuring(&bare.split_whitespace().collect::<Vec<_>>().join(" "));
    let artist = artist.trim_end_matches(" - Topic").trim_end_matches("VEVO").trim().to_string();
    let mut attempts = Vec::new();
    if let Some((left, right)) = bare.split_once(" - ") {
        attempts.push((right.trim().to_string(), left.trim().to_string()));
        attempts.push((left.trim().to_string(), artist.clone()));
    }
    attempts.push((bare, artist));
    attempts
}

fn without_featuring(title: &str) -> String {
    let lower = title.to_ascii_lowercase(); // same byte offsets as `title`
    let cut = [" ft. ", " feat. ", " ft ", " feat "].iter().filter_map(|m| lower.find(m)).min();
    title[..cut.unwrap_or(title.len())].trim().to_string()
}

fn query(endpoint: &str, params: &[(&str, &str)]) -> Reply<String> {
    let mut url = format!("{API}/{endpoint}?");
    for (i, (key, value)) in params.iter().enumerate() {
        let escaped = Uri::EscapeComponent(&HSTRING::from(*value)).map_err(|e| e.message())?;
        url.push_str(&format!("{}{key}={escaped}", if i > 0 { "&" } else { "" }));
    }
    Ok(url)
}

/// GETs a URL; `None` for 404. A busy server ("retry in a moment") gets one more try.
/// Gives up at the deadline.
fn get(client: &HttpClient, url: &str, deadline: Instant) -> Reply<Option<String>> {
    let uri = Uri::CreateUri(&HSTRING::from(url)).map_err(|e| e.message())?;
    let mut retried = false;
    loop {
        let request = client.GetAsync(&uri).map_err(|e| e.message())?;
        // Status 0 is "started"; anything else means it finished, failed or was cancelled.
        while request.Status().map_err(|e| e.message())?.0 == 0 {
            if Instant::now() > deadline {
                let _ = request.Cancel();
                return Err("LRCLIB took too long to answer".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let response = request.GetResults().map_err(|e| e.message())?;
        let status = response.StatusCode().map_err(|e| e.message())?.0;
        if status == 404 {
            return Ok(None);
        }
        if (status == 429 || status == 503) && !retried && Instant::now() + Duration::from_secs(2) < deadline {
            retried = true;
            std::thread::sleep(Duration::from_millis(1200));
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(format!("LRCLIB answered {status}"));
        }
        let body = response.Content().and_then(|c| c.ReadAsStringAsync()).and_then(|r| r.join()).map_err(|e| e.message())?;
        return Ok(Some(body.to_string()));
    }
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|dir| dir.join("lyrics"))
}

/// FNV-1a over the normalised song, stable across builds (unlike `DefaultHasher`).
fn cache_key(title: &str, artist: &str, album: &str, seconds: f64) -> u64 {
    let text = format!("{}\u{1f}{}\u{1f}{}\u{1f}{seconds}", title.trim().to_lowercase(), artist.trim().to_lowercase(), album.trim().to_lowercase());
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tidies_messy_titles() {
        let pair = |t: &str, a: &str| (t.to_string(), a.to_string());
        assert_eq!(tidy("Daft Punk - Get Lucky (Official Video) [HD]", "DaftPunkVEVO")[0], pair("Get Lucky", "Daft Punk"));
        assert_eq!(tidy("Get Lucky - Radio Edit", "Daft Punk")[1], pair("Get Lucky", "Daft Punk"));
        assert_eq!(tidy("Song ft. Someone", "Artist - Topic"), vec![pair("Song", "Artist")]);
    }

    #[test]
    fn prefers_synced_lyrics_of_the_same_length() {
        let record = |duration: f64, synced: bool| Record {
            duration,
            instrumental: false,
            plain_lyrics: Some("words".into()),
            synced_lyrics: synced.then(|| "[00:01.00] words".into()),
        };
        let picked = best(vec![record(248.0, true), record(369.0, false), record(370.0, true)], 369.0).unwrap();
        assert_eq!(picked.duration, 370.0);
        // Only a different recording has synced lyrics: keep the words, drop the timings.
        let picked = best(vec![record(248.0, true)], 369.0).unwrap();
        assert!(picked.synced_lyrics.is_none() && picked.plain_lyrics.is_some());
        assert!(best(vec![], 200.0).is_none());
    }
}
