# Input Group

Use `InputGroup` when one text input shares a visual surface with a prefix, suffix, or action. Otherwise, use the standalone `Input` component.

In `web/`, reuse the existing `SearchInput` composite when its search, clear, and IME behavior matches the feature. For other compound inputs, compose this primitive instead of absolutely positioning content over `Input`.

Compose exactly one direct `InputGroupInput` with direct `InputGroupAddon` children. `InputGroup` owns the shared border, background, focus state, and non-interactive pointer surface; `InputGroupInput` owns the native input and its value; addons own layout. Put interactive content in a semantic `Button`, `IconButton`, or link instead of adding interaction to the addon; those controls keep their own focus and events.

Place `InputGroupInput` before every `InputGroupAddon` in the DOM. The input is the primary control and addons are read or reached after it. Use `align="inline-start"` or `align="inline-end"` to choose visual placement without changing that semantic and focus order.

The initial contract supports the default input size. If another size is needed, add it to `InputGroup`, which owns the shared surface and addon layout.
