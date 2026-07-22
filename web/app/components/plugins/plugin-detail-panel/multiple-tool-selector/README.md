# Multiple Tool Selector

`index.tsx` is the public list composition for selecting and configuring multiple tools. It owns tool identity, list ordering, add and delete updates, enabled counts, and the optional collapsed state.

After a keyboard user deletes a tool, this module restores focus after the controlled `value` update. The target order is the next tool, the previous tool, then the add-tool button. `ToolSelector` only exposes the final default trigger through `triggerRef`; it does not infer sibling order.

Tools are identified by `provider_name` and `tool_name`, matching the module's deduplication contract. Callers must replace `value` after `onChange` so the list and pending focus target can settle together.

## Internal Modules

- `index.tsx`: List state composition, collapse control, and post-delete focus ownership.
- `__tests__/focus-restoration.spec.tsx`: Integration coverage through the real tool row and trigger chain.

## External Modules

- `app/components/plugins/plugin-detail-panel/tool-selector`: Single-tool trigger, Popover, and configuration form.
- `app/components/workflow/nodes/_base/components/mcp-tool-availability`: MCP availability policy.
- `service/use-tools`: Installed MCP tool data used by the enabled count.
