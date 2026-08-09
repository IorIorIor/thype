# thype

The world's simplest journal. A black space with stars, a keyboard, and nothing else.

- **Write** — the app always opens on an empty black sky. Type; letters shimmer with subtle particles. Hit **save**.
- **Thoughts** — saved entries appear as glass bubbles on a vertical timeline, newest first, each with an AI-generated title. Tap a bubble to read it; "let it go" to delete.
- **Themes** — the AI names a theme for every entry and gathers them into floating orbs, sized by how often a theme recurs. Tap one to see its thoughts.

## Accounts & privacy

Thoughts belong to an account (username + password) and are stored on the server, so they survive cleared browsers and follow you across devices.

- Passwords are scrypt-hashed; sessions are HttpOnly cookies that last ~6 months.
- If the network is away, thoughts queue in the browser (IndexedDB) and lift into the account on the next connected visit.
- Titles and themes are still generated **locally** by a tiny language model ([Qwen 2.5 0.5B](https://github.com/mlc-ai/web-llm) running in-browser via WebGPU) — your text is never sent to any AI service. The model (~350 MB) downloads once, in the background. No WebGPU? Titles fall back to a simple heuristic, silently.

## Running it

```sh
npm start            # zero-dependency Node server on :3000
```

Data lands in `./data/db.json` (or `$DATA_DIR/db.json`).

## Deploying on Railway

1. Deploy the repo as a service — Railway detects `package.json` and runs `npm start`.
2. Add a **Volume** to the service (right-click the service → Attach Volume) with **mount path `/data`** — without it, accounts and thoughts are wiped on every deploy.
3. Set the environment variable **`DATA_DIR=/data`** on the service.
4. Redeploy. Keep the service at a single replica (the store is one JSON file).

Evening reminders (a push at 20:00 local time on days without a thought) need no extra setup — VAPID keys are generated once and kept in the data volume. Optionally set `VAPID_SUBJECT=mailto:you@example.com`. Users enable reminders with the bell on the themes screen; on iPhone this requires the app installed on the home screen (iOS 16.4+).

## Stack

Vanilla HTML/CSS/JS, two `<canvas>` layers (galaxy + typing particles), a dependency-free Node server with a JSON-file store, a service worker for offline shell caching, and [WebLLM](https://github.com/mlc-ai/web-llm) for on-device titles. No frameworks, no dependencies, no telemetry.
