use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager,
};

#[cfg(target_os = "macos")]
pub fn set_activation_policy(app: &tauri::AppHandle, visible: bool) {
    use tauri::ActivationPolicy;
    if visible {
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
    } else {
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_activation_policy(_app: &tauri::AppHandle, _visible: bool) {}

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Apri AXSHARE", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sincronizza ora", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let lock = MenuItem::with_id(app, "lock", "🔒 Blocca sessione", true, None::<&str>)?;
    let disk = MenuItem::with_id(app, "disk", "Disco virtuale", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Esci da AXSHARE", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &sync, &sep1, &lock, &disk, &sep2, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("Tauri config must include bundle.icon (run: npm run tauri icon)");

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("AXSHARE")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "show" => {
                    #[cfg(target_os = "macos")]
                    set_activation_policy(app, true);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        // Non chiamare set_focus: l'utente porta in primo piano manualmente
                    }
                }
                "sync" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("tray-sync", ());
                    }
                }
                "lock" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("tray-lock-session", ());
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "disk" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("toggle-virtual-disk", ());
                    }
                }
                "quit" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("tray-quit", ());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray_icon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray_icon.app_handle().clone();
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(false);
                    if visible {
                        #[cfg(target_os = "macos")]
                        set_activation_policy(&app, false);
                        let _ = window.hide();
                    } else {
                        #[cfg(target_os = "macos")]
                        set_activation_policy(&app, true);
                        let _ = window.show();
                        // Non chiamare set_focus: l'utente porta in primo piano manualmente
                    }
                }
            }
        })
        .build(app)?;

    if let Some(state) = app.try_state::<crate::AppState>() {
        state
            .tray_id
            .lock()
            .unwrap()
            .replace(tray.id().clone());
    }

    Ok(())
}
