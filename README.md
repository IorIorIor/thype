# thype

The world's simplest journal. A black space with stars, a keyboard, and nothing else.

- **Write** — the app always opens on an empty black sky. Type; letters shimmer with subtle particles. Hit **save**.
- **Thoughts** — saved entries appear as glass bubbles on a vertical timeline, newest first, each with an AI-generated title. Tap a bubble to read it; "let it go" to delete.
- **Themes** — the AI names a theme for every entry and gathers them into floating orbs, sized by how often a theme recurs. Tap one to see its thoughts.

## Privacy

Everything stays on your device.

- Entries live in your browser's IndexedDB — no accounts, no server, nothing leaves your phone.
- Titles and themes are generated **locally** by a tiny language model ([Qwen 2.5 0.5B](https://github.com/mlc-ai/web-llm) running in-browser via WebGPU). The model (~350 MB) downloads once, in the background, the first time you save.
- No WebGPU? The app still works — titles fall back to a simple heuristic, silently.

## Running it

It's a static site — no build step.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Or enable **GitHub Pages** on this repo (Settings → Pages → deploy from `main`) and install it as a PWA from your phone's browser: it works offline after the first visit.

## Stack

Vanilla HTML/CSS/JS, two `<canvas>` layers (starfield + typing particles), IndexedDB, a service worker for offline, and [WebLLM](https://github.com/mlc-ai/web-llm) for on-device titles. No frameworks, no dependencies, no telemetry.
