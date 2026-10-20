# Multiple Tool Selector

`index.tsx` is the public list composition for selecting and configuring multiple tools. It owns tool identity, list ordering, add and delete updates, enabled counts, and the optional collapsed state.

After a keyboard user deletes a tool, this module restores focus after the controlled `value` update. The target order is the next tool, the previous tool, then the add-tool button. `ToolSelector` only exposes the final default trigger through `triggerRef`; it does not infer sibling order.

Tools are identified by `provider_name` and `tool_name`, matching the module's deduplication contract. Callers must replace `value` after `onChange` so the list and pending focus target can settle together.

MCP availability remains owned by the workflow policy, and installed-tool data remains owned by its query. This list only adapts those results into ordering, counts, and selection updates.
