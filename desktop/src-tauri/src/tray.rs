use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager,
};

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Apri AXSHARE", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Blocca sessione", true, None::<&str>)?;
    let disk = MenuItem::with_id(app, "disk", "Disco virtuale", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &lock, &disk, &separator, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("Tauri config must include bundle.icon (run: npm run tauri icon)");

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("AXSHARE")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "lock" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("session-lock", ());
                    }
                }
                "disk" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("toggle-virtual-disk", ());
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
