# Testing checklist

Use this before publishing a release.

## Before opening Obsidian

- Run `npm run build`.
- Copy `main.js`, `manifest.json`, and `styles.css` into the test vault plugin folder.
- Confirm `manifest.json` has the intended version.
- Confirm `main.js` does not contain old external domains such as `cdnjs` or `bing`.

## Obsidian startup

- Open the test vault.
- Enable or reload Ollama Assistant.
- Confirm the plugin loads without a startup notice/error.
- Open the plugin settings.
- Confirm the settings page renders normally.
- Confirm the Lottie animation is visible.

## Connection and models

- Start Ollama locally if it is not running.
- In Obsidian, confirm the status area detects Ollama.
- Confirm the model list loads.
- Select a small known-working model.
- If Ollama is stopped, confirm the error banner appears and looks normal.

## Edit mode

- Open a note with a short paragraph.
- Select text.
- Add the selected text as context.
- Ask for a simple edit, for example: `Make this clearer in one paragraph.`
- Confirm the response streams gradually.
- Confirm the edited text appears.
- Test the main action buttons:
  - apply edit;
  - copy result;
  - continue/refine if available;
  - keep original under spoiler if available.

## Discuss mode

- Switch to Discuss mode.
- Send a simple question about the current note.
- Confirm the response streams gradually.
- Send a follow-up question.
- Confirm the previous message is remembered.
- Clear the current chat and confirm the visible history resets.

## Web mode

- Switch to Web mode.
- Ask a factual query that needs search, for example: `What is the latest stable Obsidian version?`
- Confirm Web mode starts a search.
- Confirm the result is not instant hallucinated text.
- Confirm the UI shows search/progress state normally.
- Confirm no Bing or CDN usage is expected; DuckDuckGo is the intended search provider.

## Context features

- Add selected text as context.
- Add the entire current note as context.
- Open the context tooltip/info indicator.
- Remove or replace context.
- Confirm context indicators update correctly.

## UI checks

Check both light and dark Obsidian themes:

- mode switcher;
- chat messages;
- input area;
- action buttons;
- status bar;
- model menu;
- context menu;
- buffer indicator;
- error banner;
- tooltips.

Nothing should overlap, disappear, or become unreadable.

## Final release sanity

- `npm run build` still passes.
- The test vault still has the same files as the release build.
- The plugin version is correct.
- Streaming still works.
- Web mode still works.
- Settings still open.
- Lottie still works.
- User explicitly approved publishing.
