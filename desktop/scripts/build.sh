#!/bin/bash
# Build script AXSHARE Desktop
set -e

PLATFORM="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔨 Building AXSHARE Desktop for $PLATFORM"

# Build frontend
echo "📦 Building frontend..."
cd "$PROJECT_ROOT/../frontend"
npm run build:tauri
echo "✅ Frontend built"

# Build Tauri app
echo "🦀 Building Tauri app..."
cd "$PROJECT_ROOT"
if [ "$PLATFORM" = "darwin" ]; then
  cargo tauri build --target universal-apple-darwin
elif [ "$PLATFORM" = "windows" ]; then
  cargo tauri build --target x86_64-pc-windows-msvc
else
  cargo tauri build
fi

echo "✅ Build complete!"
echo "Output: $PROJECT_ROOT/src-tauri/target/release/bundle/"
