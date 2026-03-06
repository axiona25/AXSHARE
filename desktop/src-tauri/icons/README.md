# AXSHARE Desktop Icons

Generate app and tray icons from a single source image (e.g. 1024x1024 PNG):

```bash
# From repo root: add app-icon.png (1024x1024) in desktop/ then:
cd desktop
npm run tauri icon ../app-icon.png
```

Or use the Tauri CLI directly:

```bash
cd desktop
npx tauri icon path/to/source.png
```

This creates `icons/32x32.png`, `icons/128x128.png`, `icon.icns`, `icon.ico`, etc.
Required for `cargo tauri build` and for the system tray icon.
