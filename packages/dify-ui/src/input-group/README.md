# Input Group

Use `InputGroup` when one text input shares a visual surface with a prefix, suffix, or action. Otherwise, use the standalone `Input` component.

Compose exactly one direct `InputGroupInput` with direct `InputGroupAddon` children. `InputGroup` owns the shared border, background, and focus state; `InputGroupInput` owns the native input and its value; addons only own layout. Put interactive content in a semantic `Button`, `IconButton`, or link instead of adding interaction to the addon.

The initial contract supports the default input size. If another size is needed, add it to `InputGroup`, which owns the shared surface and addon layout.
