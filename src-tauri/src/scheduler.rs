//! Alarms for task reminders, focus sessions and routines. The frontend owns the data and
//! sends every upcoming alarm; this thread fires them on time even if the webview is
//! throttled, runs routine actions and shows a Windows notification.

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    id: String,
    /// Unix time in ms.
    at: u64,
    /// How late it may still fire (after the PC wakes up, say), in ms.
    grace: u64,
    title: String,
    body: String,
    #[serde(default)]
    notify: bool,
    #[serde(default)]
    actions: Vec<Action>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    App { id: String },
    Url { url: String },
}

#[derive(Default)]
pub struct Scheduler {
    alarms: Mutex<Vec<Alarm>>,
    wake: Condvar,
    /// Alarms that already fired (id → when), so a resent list can't fire one twice.
    fired: Mutex<HashMap<String, u64>>,
}

pub fn start(app: &AppHandle) {
    let scheduler = Arc::new(Scheduler::default());
    app.manage(scheduler.clone());
    let app = app.clone();
    std::thread::Builder::new()
        .name("scheduler".into())
        .spawn(move || run(&app, &scheduler))
        .expect("failed to start the scheduler");
}

fn run(app: &AppHandle, scheduler: &Scheduler) {
    loop {
        let due = {
            let mut alarms = scheduler.alarms.lock().unwrap();
            let now = now_ms();
            let (due, pending): (Vec<Alarm>, Vec<Alarm>) =
                std::mem::take(&mut *alarms).into_iter().partition(|alarm| alarm.at <= now);
            *alarms = pending;
            if due.is_empty() {
                // The wall clock can jump (sleep, time sync), so never wait more than 30 s.
                let next = alarms.iter().map(|alarm| alarm.at.saturating_sub(now)).min();
                let wait = next.unwrap_or(u64::MAX).clamp(10, 30_000);
                drop(scheduler.wake.wait_timeout(alarms, Duration::from_millis(wait)).unwrap());
                continue;
            }
            due
        };
        let now = now_ms();
        for alarm in due {
            if now.saturating_sub(alarm.at) <= alarm.grace {
                fire(app, scheduler, &alarm, now);
            }
        }
    }
}

fn fire(app: &AppHandle, scheduler: &Scheduler, alarm: &Alarm, now: u64) {
    {
        let mut fired = scheduler.fired.lock().unwrap();
        fired.retain(|_, at| now.saturating_sub(*at) < 3 * 24 * 3_600_000);
        fired.insert(alarm.id.clone(), now);
    }
    for action in &alarm.actions {
        let result = match action {
            Action::App { id } => {
                let id = id.clone();
                crate::com::on_sta(move || crate::shell::launch_app(&id))
            }
            Action::Url { url } => {
                let url = url.clone();
                crate::com::on_sta(move || crate::shell::open_url(&url))
            }
        };
        if let Err(error) = result {
            eprintln!("routine action failed: {error}");
        }
    }
    if alarm.notify {
        let _ = app.notification().builder().title(&alarm.title).body(&alarm.body).show();
    }
    let _ = app.emit("alarm", &alarm.id);
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Replaces the whole alarm list; the frontend resends it whenever its data changes.
#[tauri::command]
pub fn schedule_set(alarms: Vec<Alarm>, scheduler: State<'_, Arc<Scheduler>>) {
    let fresh: Vec<Alarm> = {
        let fired = scheduler.fired.lock().unwrap();
        alarms.into_iter().filter(|alarm| !fired.contains_key(&alarm.id)).collect()
    };
    *scheduler.alarms.lock().unwrap() = fresh;
    scheduler.wake.notify_one();
}
