# Deferred scorecard risks

This file tracks warnings that should not be removed mechanically.

Rule: if removing a warning changes layout, behavior, streaming, animations, or compatibility, do not force the cleanup. Add it here with:

- current warning;
- why it exists;
- what broke when we tried to remove it;
- possible safer replacement;
- required manual test.

## `fetch()` for streaming Ollama responses

Current location:

- `ollama-client.ts`

Scorecard warning/disclosure:

- `Found 1 fetch()`

Why it exists:

- The chat needs streaming responses.
- Obsidian `requestUrl` is used elsewhere, but it does not replace this streaming path cleanly.

Current decision:

- Keep `fetch()` for streaming.
- Do not replace it with `requestUrl` unless we have a proven streaming-safe implementation.

Required manual test for any future change:

- Long response streams gradually.
- Stop button interrupts generation.
- Partial content is not duplicated.
- No final message is lost.
- Local Ollama errors still show the error banner.

## `XMLHttpRequest` from Lottie

Likely source:

- bundled `lottie-web`

Scorecard warning/disclosure:

- `Found 1 XMLHttpRequest`

Why it exists:

- Lottie runtime includes internal XHR support.
- The plugin currently imports local bundled `lottie-web`, not CDN Lottie.

What happened when replaced:

- A previous attempt to replace Lottie with a local non-Lottie animation broke animations.

Current decision:

- Keep Lottie for now.
- Do not replace it during broad scorecard cleanup.

Possible future fix:

- Build a small custom CSS/SVG/canvas animation that visually matches current behavior.
- Or find a Lottie build/runtime path that does not include XHR code.

Required manual test:

- Settings animation works.
- Error banner animation works.
- No CDN domain appears in built `main.js`.
- No visual regressions in light/dark themes.

## Malware/network scans unavailable

Scorecard text:

- `Malware scan not available.`
- `Network requests scan not available.`

Why it exists:

- Obsidian scorecards are marked as work in progress.
- These are missing scan results, not confirmed plugin problems.

Current decision:

- Nothing to change in code unless Obsidian later reports a concrete issue.
