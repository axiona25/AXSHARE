use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::time::interval;
use tauri::{AppHandle, Manager, State};
use tauri::Emitter;

use crate::AppState;

pub struct AutoLock {
    last_activity: Arc<Mutex<Instant>>,
    timeout_minutes: Arc<Mutex<u64>>,
    enabled: Arc<Mutex<bool>>,
}

impl AutoLock {
    pub fn new() -> Self {
        Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            timeout_minutes: Arc::new(Mutex::new(15)), // default 15 min
            enabled: Arc::new(Mutex::new(true)),
        }
    }

    pub fn register_activity(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    pub fn set_timeout(&self, minutes: u64) {
        *self.timeout_minutes.lock().unwrap() = minutes;
    }

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.lock().unwrap() = enabled;
    }

    pub fn start_monitor(&self, app_handle: AppHandle) {
        let last_activity = self.last_activity.clone();
        let timeout_minutes = self.timeout_minutes.clone();
        let enabled = self.enabled.clone();

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(30)); // check ogni 30s
            loop {
                ticker.tick().await;
                let is_enabled = *enabled.lock().unwrap();
                if !is_enabled {
                    continue;
                }
                let timeout = *timeout_minutes.lock().unwrap();
                if timeout == 0 {
                    continue; // 0 = mai
                }
                let elapsed = last_activity.lock().unwrap().elapsed();
                if elapsed >= Duration::from_secs(timeout * 60) {
                    log::info!("Auto-lock triggered after {} minutes of inactivity", timeout);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("session-lock", ());
                        // Mostra finestra se era nascosta (per mostrare lock screen)
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
    }
}

#[tauri::command]
pub fn set_autolock_timeout(minutes: u64, state: State<AppState>) {
    state.autolock.set_timeout(minutes);
    log::info!("Auto-lock timeout set to {} minutes", minutes);
}

#[tauri::command]
pub fn set_autolock_enabled(enabled: bool, state: State<AppState>) {
    state.autolock.set_enabled(enabled);
}

#[tauri::command]
pub fn register_user_activity(state: State<AppState>) {
    state.autolock.register_activity();
}
