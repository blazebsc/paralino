# Run configurations

- **Paralino Dev (directDebug)** — the self-host development build:
  package `app.paralino.android.dev`, in-app logging on, email verification
  bypassed, points at the server entered on the in-app setup screen.

## One-time IDE setup

1. Open the project in Android Studio.
2. **Build → Select Build Variant** → `androidApp` → **directDebug**
   (the run config builds the current variant; this pins it).
3. Pick the "Paralino Dev (directDebug)" configuration in the Run dropdown → Run.

## Server selection

First launch asks for your backend URL (e.g. `https://<your-function-domain>`).
The app fetches `<url>/config` and self-configures. To change servers later:
clear app data (Settings → Apps → ParalinoDEV → Clear data) and relaunch.
