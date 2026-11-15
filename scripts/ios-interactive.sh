#!/usr/bin/env bash
set -euo pipefail
LOGREPO=/tmp/logrepo
git clone -q --depth 1 "https://x-access-token:${GITHUB_TOKEN:-}@github.com/${GITHUB_REPOSITORY}.git" $LOGREPO 2>/dev/null || true
( while true; do sleep 45; cp /tmp/appium.log $LOGREPO/appium.log 2>/dev/null; ( cd $LOGREPO && git checkout -q -B device-log && git add -A && git -c user.email=a@b -c user.name=ci commit -qm log && git push -qf origin device-log ) >/dev/null 2>&1; done ) &
MINUTES=${1:-45}; [ "$MINUTES" -gt 90 ] && MINUTES=90
brew install cloudflared >/dev/null 2>&1 &
BREW=$!
npm i -g appium@latest >/dev/null 2>&1
appium driver install xcuitest >/dev/null 2>&1
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json,sys
d=json.load(sys.stdin)['devices']
for rt in sorted(d,reverse=True):
    if 'iOS-26' in rt:
        for x in d[rt]:
            if x['name']=='iPhone 17': print(x['udid']); raise SystemExit
")
echo "udid chosen"
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b >/dev/null
nohup appium --port 4723 --base-path / --log-level warn > /tmp/appium.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:4723/status >/dev/null && break; sleep 2; done
wait $BREW
CAPS=$(printf '{"capabilities":{"alwaysMatch":{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"%s","appium:bundleId":"com.apple.mobilesafari","appium:wdaLaunchTimeout":420000,"appium:noReset":true,"appium:newCommandTimeout":7200}}}' "$UDID")
SID=$(curl -s -m 600 -X POST localhost:4723/session -H 'content-type: application/json' -d "$CAPS" | python3 -c "import json,sys;print(json.load(sys.stdin)['value']['sessionId'])")
echo "session created"
bash scripts/publish-tunnel.sh ios "$SID" "$MINUTES"
