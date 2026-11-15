#!/usr/bin/env bash
# Starts proxy + cloudflared quick tunnel, prints the encrypted connection blob, then waits.
# Args: platform sessionId minutes
set -euo pipefail
PLATFORM=$1; SID=$2; MINUTES=$3
TOKEN=$(openssl rand -hex 16); echo "::add-mask::$TOKEN"
export TOKEN PLATFORM SID
rm -f /tmp/stop
nohup node scripts/proxy.mjs /tmp/stop > /tmp/proxy.log 2>&1 &
sleep 1
nohup cloudflared tunnel --url http://127.0.0.1:8080 --no-autoupdate > /tmp/cf.log 2>&1 &
for i in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf.log | head -1 || true)
  [ -n "$URL" ] && break; sleep 2
done
[ -n "${URL:-}" ] || { echo "no tunnel"; cat /tmp/cf.log; exit 1; }
echo "::add-mask::$URL"
BLOB=$(printf '%s|%s|%s' "$URL" "$TOKEN" "$SID" | openssl pkeyutl -encrypt -pubin -inkey interactive-public.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 | base64 | tr -d '\n')
echo "ENC:$BLOB"
# Actions cannot read in-progress logs, so also park the (encrypted) blob on an orphan branch.
git config user.email "actions@users.noreply.github.com"; git config user.name "device-check"
git checkout -q --orphan device-blob; git rm -rqf . >/dev/null 2>&1 || true
printf '%s %s\n' "$GITHUB_RUN_ID" "$BLOB" > blob.txt
git add blob.txt; git commit -qm "blob"; git push -qf origin device-blob
{ echo "### Interactive device ready"; echo; echo "Encrypted connection blob (only the owner key opens it):"; echo; echo '```'; echo "$BLOB"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
END=$(( $(date +%s) + MINUTES*60 ))
while [ "$(date +%s)" -lt "$END" ] && [ ! -f /tmp/stop ]; do sleep 5; done
echo "interactive session over"
