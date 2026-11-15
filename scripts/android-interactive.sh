#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner (emulator already booted).
set -euo pipefail
MINUTES=${MINUTES:-45}; [ "$MINUTES" -gt 90 ] && MINUTES=90
npm i -g appium@latest >/dev/null 2>&1
appium driver install uiautomator2 >/dev/null 2>&1
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared 2>/dev/null || sudo curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared 2>/dev/null || sudo chmod +x /usr/local/bin/cloudflared
nohup appium --port 4723 --base-path / --log-level warn --allow-insecure uiautomator2:adb_shell > /tmp/appium.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:4723/status >/dev/null && break; sleep 2; done
CAPS='{"capabilities":{"alwaysMatch":{"platformName":"Android","appium:automationName":"UiAutomator2","appium:appPackage":"com.android.chrome","appium:appActivity":"com.google.android.apps.chrome.Main","appium:noReset":true,"appium:newCommandTimeout":7200,"appium:autoGrantPermissions":true}}}'
SID=$(curl -s -m 300 -X POST localhost:4723/session -H 'content-type: application/json' -d "$CAPS" | python3 -c "import json,sys;print(json.load(sys.stdin)['value']['sessionId'])")
# Dismiss Chrome first-run screens (pixel_7 profile, 1080x2400)
adb shell am start -a android.intent.action.VIEW -d about:blank -n com.android.chrome/com.google.android.apps.chrome.Main >/dev/null || true
sleep 6; adb shell input tap 540 2092; sleep 3; adb shell input tap 592 1746; sleep 2
bash scripts/publish-tunnel.sh android "$SID" "$MINUTES"
