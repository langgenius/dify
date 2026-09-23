# Tool Selector

`index.tsx` is the public single-tool selector. It owns the configured or unconfigured trigger, Popover lifecycle, tool form, authorization, settings, and deletion action wiring.

The built-in trigger branch accepts `triggerRef`, which always resolves to its final native button. Callers that provide a custom `trigger` own that element and its ref directly. The two trigger modes are mutually exclusive in the component type contract.

Deletion only reports intent through `onDelete`. This module does not infer sibling order or choose a post-delete focus target; a list composition owner must coordinate that behavior.

The Popover owns the selector surface. Nested reasoning and schema configuration use feature-owned forms and Dify UI Dialog rather than introducing another overlay wrapper. Plugin authorization, provider data, and MCP availability remain owned by their source features and queries.
