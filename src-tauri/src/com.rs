//! COM apartments.

use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;

use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED};

/// Joins the multithreaded apartment on the current thread. Safe to call repeatedly.
pub fn init_mta() {
    // S_FALSE only means the thread had already joined.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

type Job = Box<dyn FnOnce() + Send>;

/// Runs `job` on one long-lived single-threaded apartment. Shell objects (icons, thumbnail
/// handlers, the wallpaper API) expect an STA, and running them all on one thread keeps
/// that guarantee without initialising COM on Tauri's worker threads.
pub fn on_sta<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> T {
    static WORKER: OnceLock<Sender<Job>> = OnceLock::new();
    let worker = WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("shell-sta".into())
            .spawn(move || {
                let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
                for job in rx {
                    job();
                }
            })
            .expect("failed to start the shell thread");
        tx
    });
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    worker
        .send(Box::new(move || {
            let _ = done_tx.send(job());
        }))
        .expect("the shell thread stopped");
    done_rx.recv().expect("a shell job panicked")
}
