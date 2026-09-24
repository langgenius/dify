# Self-hosted emoji data

`emojibase-17.0.0/en/{data,messages}.json` are vendored files from
`emojibase-data@17.0.0` (MIT; license included). Frimousse uses only these two
files. A final newline is added where needed to satisfy EditorConfig; JSON contents
are unchanged. Keep `locale="en"` to preserve the existing English search vocabulary.
The URL includes the deployment base path and never falls back to a CDN.

To update, extract these files and LICENSE from the corresponding npm tarball,
use a new versioned directory, and update the picker URL together.

Legacy Emoji Mart ids are normalized to Unicode in the API (`api/libs/emoji_legacy.json`).
The web app renders persisted emoji values directly.
Emoji Mart data is MIT licensed: https://github.com/missive/emoji-mart.
