#!/bin/bash
# desktop/scripts/generate-icons.sh
# Richiede: ImageMagick (brew install imagemagick)

SOURCE="assets/icon-source-1024.png"  # PNG 1024x1024 da fornire
ICONS_DIR="src-tauri/icons"
mkdir -p "$ICONS_DIR"

# PNG sizes
for size in 32 128 256 512; do
  convert "$SOURCE" -resize "${size}x${size}" "$ICONS_DIR/${size}x${size}.png"
done
convert "$SOURCE" -resize "256x256" "$ICONS_DIR/128x128@2x.png"

# macOS .icns
mkdir -p /tmp/axshare.iconset
for size in 16 32 64 128 256 512; do
  convert "$SOURCE" -resize "${size}x${size}" "/tmp/axshare.iconset/icon_${size}x${size}.png"
  convert "$SOURCE" -resize "$((size*2))x$((size*2))" "/tmp/axshare.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns /tmp/axshare.iconset -o "$ICONS_DIR/icon.icns"

# Windows .ico (multi-resolution)
convert "$SOURCE" -resize 256x256 \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  -delete 0 "$ICONS_DIR/icon.ico"

# Tray icon (template per Mac — deve essere monocromatica)
convert "$SOURCE" -resize "22x22" -colorspace Gray "$ICONS_DIR/tray-icon.png"

echo "Icone generate in $ICONS_DIR"
