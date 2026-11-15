# phone-in-actions

Real Android and iPhone devices on free GitHub Actions runners, driven live from your laptop.

- `interactive` workflow: boots an Android emulator (Ubuntu with KVM) or an iPhone simulator (macOS runner), starts Appium, and exposes the device through a token-gated proxy on a free cloudflared quick tunnel. The proxy also serves a clickable live view, so a person can step in (for example to sign in) and hand the device back.
- `fixtures/`: sample photos (one with an EXIF date, one HEIC), a 23-page sample PDF and an empty PDF for upload tests.

Runs on `workflow_dispatch` only, so it costs nothing while idle. Free on public repos.
