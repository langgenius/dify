# Self-hosted emoji data

`emojibase-17.0.0/en/{data,messages}.json` are vendored files from
`emojibase-data@17.0.0` (MIT; license included). Frimousse uses only these two
files. A final newline is added where needed to satisfy EditorConfig; JSON contents
are unchanged. Keep `locale="en"` to preserve the existing English search vocabulary.
The URL includes the deployment base path and never falls back to a CDN.

To update, extract these files and LICENSE from the corresponding npm tarball,
use a new versioned directory, and update the picker URL together.

`web/utils/emoji-legacy.json` is the frozen compatibility map generated from
`@emoji-mart/data@1.2.1/sets/15/native.json`: each `emojis` key maps to its first
skin's `native` value, followed by every `aliases` key mapped through its target.
It is retained independently of picker data updates so persisted IDs keep working.
Emoji Mart data is MIT licensed: https://github.com/missive/emoji-mart.
