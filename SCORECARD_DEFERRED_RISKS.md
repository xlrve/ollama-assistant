# Deferred scorecard risks

This file tracks warnings that should not be removed mechanically.

Rule: if removing a warning changes layout, behavior, streaming, animations, or compatibility, do not force the cleanup. Add it here with:

- current warning;
- why it exists;
- what broke when we tried to remove it;
- possible safer replacement;
- required manual test.

## `all: unset` on corner input buttons

Current selectors:

- `.send-btn-corner`
- `.model-btn-corner`
- `.quick-edits-btn-corner`

Scorecard warning:

- `Unexpected property "all"`

Why it exists:

- These are highly tuned corner controls in the chat input area.
- Obsidian themes and default button styles otherwise add shadows, inherited sizing, and layout changes.
- The buttons depend on exact position, padding, font sizing, and border behavior.

What happened when removed:

- Shadows appeared on `Model`, `Prompts`, and `Send`.
- After adding a partial reset, shadows disappeared but button placement changed.
- Restoring `all: unset !important` only for these three controls restored the expected layout.

Current decision:

- Keep `all: unset !important` for these three selectors for now.
- Do not remove them as part of broad CSS cleanup.

Possible future fix:

- Replace each `all: unset` with a complete explicit reset that preserves exact layout:
  - `appearance`;
  - `display`;
  - `position`;
  - `box-sizing`;
  - `min-width`;
  - `min-height`;
  - `width`;
  - `height`;
  - `padding`;
  - `margin`;
  - `font`;
  - `line-height`;
  - `letter-spacing`;
  - `background`;
  - `background-image`;
  - `border`;
  - `box-shadow`;
  - `outline`;
  - `transform`;
  - `text-shadow`;
  - `vertical-align`.

Required manual test:

- Open the chat input area in Edit mode.
- Check exact placement of `Model`, `Prompts`, and `Send`.
- Switch to Discuss mode and Web mode.
- Check `Send` and stop-mode state during streaming.
- Check light and dark themes.
- Check compact/narrow mode.

Acceptable outcome:

- If a full reset cannot preserve exact layout, keep the three `all: unset` warnings.

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

