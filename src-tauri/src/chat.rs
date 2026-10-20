//! The Chatbot tab's model: gpt-oss-120b on Groq's free tier, through Groq's
//! OpenAI-compatible API. The frontend builds each request and runs the conversation; this
//! side keeps the API key in Windows Credential Manager (it never goes back to the webview),
//! adds it to the request and sends it with WinRT's HttpClient, like lyrics.rs.

use std::time::{Duration, Instant};

use windows::core::{HSTRING, PWSTR};
use windows::Foundation::Uri;
use windows::Storage::Streams::UnicodeEncoding;
use windows::Web::Http::{HttpClient, HttpMethod, HttpRequestMessage, HttpResponseMessage, HttpStringContent};
use windows::Win32::Security::Credentials::{CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};

const API: &str = "https://api.groq.com/openai/v1/chat/completions";
/// The key's name in Credential Manager (Windows Credentials → Generic Credentials).
const TARGET: &str = "Tama/Groq API key";
/// One request, retry included, gets this long.
const DEADLINE: Duration = Duration::from_secs(90);
/// The free tier also limits tokens per minute, which a few quick tool steps can reach.
/// A wait up to this long is sat out instead of shown as an error.
const MAX_WAIT: Duration = Duration::from_secs(20);

type Reply<T> = Result<T, String>;

#[tauri::command]
pub fn chat_key_status() -> bool {
    read_key().is_some()
}

/// Saves the key, or forgets it when `key` is empty.
#[tauri::command]
pub fn chat_key_set(key: String) -> Reply<()> {
    let key = key.trim();
    let target = HSTRING::from(TARGET);
    if key.is_empty() {
        // Already gone is fine.
        let _ = unsafe { CredDeleteW(&target, CRED_TYPE_GENERIC, None) };
        return Ok(());
    }
    let mut blob = key.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_ptr().cast_mut()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0) }.map_err(|e| e.message())
}

fn read_key() -> Option<String> {
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        CredReadW(&HSTRING::from(TARGET), CRED_TYPE_GENERIC, None, &mut credential).ok()?;
        let c = &*credential;
        let key = (c.CredentialBlobSize > 0)
            .then(|| std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize))
            .and_then(|blob| String::from_utf8(blob.to_vec()).ok());
        CredFree(credential.cast());
        key
    }
}

/// Sends one chat completions request. `body` is the JSON the frontend wrote; the answer is
/// the JSON text Groq sent back.
#[tauri::command]
pub async fn chat_send(body: String) -> Reply<String> {
    let key = read_key().ok_or("Add your Groq API key first.")?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::com::init_mta();
        post(&key, &body)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// POSTs the request, trying once more when that's likely to work: after a short
/// per-minute limit, a busy server, or a garbled tool call from the model.
fn post(key: &str, body: &str) -> Reply<String> {
    let client = HttpClient::new().map_err(|e| e.message())?;
    let uri = Uri::CreateUri(&HSTRING::from(API)).map_err(|e| e.message())?;
    let deadline = Instant::now() + DEADLINE;
    let mut retried = false;
    loop {
        // A request message can only be sent once, so the retry builds a new one.
        let request = HttpRequestMessage::Create(&HttpMethod::Post().map_err(|e| e.message())?, &uri).map_err(|e| e.message())?;
        let headers = request.Headers().map_err(|e| e.message())?;
        headers
            .TryAppendWithoutValidation(&HSTRING::from("Authorization"), &HSTRING::from(format!("Bearer {key}")))
            .map_err(|e| e.message())?;
        let content = HttpStringContent::CreateFromStringWithEncodingAndMediaType(&HSTRING::from(body), UnicodeEncoding::Utf8, &HSTRING::from("application/json"))
            .map_err(|e| e.message())?;
        request.SetContent(&content).map_err(|e| e.message())?;

        let sending = client.SendRequestAsync(&request).map_err(|e| e.message())?;
        // Status 0 is "started"; anything else means it finished, failed or was cancelled.
        while sending.Status().map_err(|e| e.message())?.0 == 0 {
            if Instant::now() > deadline {
                let _ = sending.Cancel();
                return Err("The chatbot took too long to answer. Try again.".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let response = sending.GetResults().map_err(|e| format!("Couldn't reach Groq. Check your internet connection. ({})", e.message().trim()))?;
        let status = response.StatusCode().map_err(|e| e.message())?.0;
        let text = response.Content().and_then(|c| c.ReadAsStringAsync()).and_then(|r| r.join()).map_err(|e| e.message())?.to_string();
        if (200..300).contains(&status) {
            return Ok(text);
        }
        if !retried {
            let wait = match status {
                400 if error_code(&text) == "tool_use_failed" => Some(Duration::ZERO),
                429 => retry_after(&response).filter(|wait| *wait <= MAX_WAIT),
                500..=599 => Some(Duration::from_secs(2)),
                _ => None,
            };
            if let Some(wait) = wait.filter(|wait| Instant::now() + *wait + Duration::from_secs(5) < deadline) {
                retried = true;
                std::thread::sleep(wait);
                continue;
            }
        }
        return Err(explain(status, &text));
    }
}

/// Groq says how long to wait, in seconds, when a limit is reached.
fn retry_after(response: &HttpResponseMessage) -> Option<Duration> {
    let value = response.Headers().ok()?.Lookup(&HSTRING::from("retry-after")).ok()?;
    value.to_string().trim().parse::<f64>().ok().filter(|s| *s >= 0.0).map(Duration::from_secs_f64)
}

fn error_field(body: &str, field: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"][field].as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn error_code(body: &str) -> String {
    error_field(body, "code")
}

/// One sentence for the chat. Groq's own message is kept where it says something useful.
fn explain(status: i32, body: &str) -> String {
    let message = error_field(body, "message");
    match status {
        401 => "Groq didn't accept that API key.".into(),
        // "… Please try again in 7.917s. Need more tokens? …"
        429 => {
            let wait = message.split_once("try again in ").and_then(|(_, rest)| rest.split_whitespace().next()).map(|w| w.trim_end_matches('.'));
            format!("Groq's free limit is used up for now. Try again in {}.", wait.unwrap_or("a minute"))
        }
        500..=599 => "Groq is busy right now. Try again in a moment.".into(),
        _ if error_code(body) == "tool_use_failed" => "The chatbot fumbled a step. Try again.".into(),
        _ if !message.is_empty() => message,
        _ => format!("Groq answered with an error ({status})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_errors() {
        assert_eq!(explain(401, ""), "Groq didn't accept that API key.");
        let tpm = r#"{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7521, Requested 1534. Please try again in 7.917s. Need more tokens?","type":"tokens","code":"rate_limit_exceeded"}}"#;
        assert_eq!(explain(429, tpm), "Groq's free limit is used up for now. Try again in 7.917s.");
        assert_eq!(explain(429, ""), "Groq's free limit is used up for now. Try again in a minute.");
        let tool = r#"{"error":{"message":"Failed to call a function.","type":"invalid_request_error","code":"tool_use_failed"}}"#;
        assert_eq!(explain(400, tool), "The chatbot fumbled a step. Try again.");
        let bad = r#"{"error":{"message":"The model `x` does not exist","type":"invalid_request_error","code":"model_not_found"}}"#;
        assert_eq!(explain(404, bad), "The model `x` does not exist");
        assert_eq!(explain(404, "not json"), "Groq answered with an error (404).");
        assert_eq!(explain(503, ""), "Groq is busy right now. Try again in a moment.");
    }
}
