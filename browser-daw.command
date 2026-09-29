#!/bin/bash
# ===================================================================
#  Browser DAW  -  macOS launcher
#  ダブルクリック、または ./browser-daw.command で起動します。
# ===================================================================
cd "$(dirname "$0")" || exit 1
PAGE="$PWD/index.html"

if [ ! -f "$PAGE" ]; then
  echo "[ERROR] index.html が見つかりません: $PAGE"
  read -r -p "Enter キーで閉じます..." _
  exit 1
fi

# パスを file:// URL に変換 (スペース等をエスケープ)
url_encode() {
  local s="$1" out="" c
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [-_.~a-zA-Z0-9/]) out+="$c" ;;
      *) printf -v c '%%%02X' "'$c"; out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}
PAGEURL="file://$(url_encode "$PAGE")"
PROFILE="$HOME/Library/Application Support/BrowserDAW/profile"

echo
echo "  =========================================="
echo "     Browser DAW  -  starting..."
echo "  =========================================="
echo

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  BROWSER=""
  for b in "$CHROME" "$EDGE" "$BRAVE"; do
    [ -x "$b" ] && BROWSER="$b" && break
  done
  if [ -n "$BROWSER" ]; then
    echo "  using: $BROWSER"
    mkdir -p "$PROFILE"
    "$BROWSER" --app="$PAGEURL" --user-data-dir="$PROFILE" \
               --window-size=1600,980 \
               --autoplay-policy=no-user-gesture-required \
               --disable-background-timer-throttling \
               --disable-renderer-backgrounding \
               --disable-backgrounding-occluded-windows \
               --allow-file-access-from-files >/dev/null 2>&1 &
  else
    echo "  Chrome 系が見つからないため、既定のブラウザ (Safari 等) で開きます。"
    open "$PAGE"
  fi
else
  for b in google-chrome chromium chromium-browser microsoft-edge brave-browser; do
    if command -v "$b" >/dev/null 2>&1; then
      "$b" --app="$PAGEURL" --user-data-dir="$PROFILE" --window-size=1600,980 \
           --autoplay-policy=no-user-gesture-required \
           --disable-background-timer-throttling \
           --disable-renderer-backgrounding --allow-file-access-from-files >/dev/null 2>&1 &
      exit 0
    fi
  done
  xdg-open "$PAGE" >/dev/null 2>&1 &
fi
