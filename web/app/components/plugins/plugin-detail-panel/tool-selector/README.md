# Tool Selector

`index.tsx` is the public single-tool selector. It owns the configured or unconfigured trigger, Popover lifecycle, tool form, authorization, settings, and deletion action wiring.

The built-in trigger branch accepts `triggerRef`, which always resolves to its final native button. Callers that provide a custom `trigger` own that element and its ref directly. The two trigger modes are mutually exclusive in the component type contract.

Deletion only reports intent through `onDelete`. This module does not infer sibling order or choose a post-delete focus target; a list composition owner must coordinate that behavior.

## Internal Modules

- `components/tool-item`: Configured tool row and its primary and secondary actions.
- `components/tool-trigger`: Default unconfigured tool trigger.
- `components/tool-base-form`, `components/tool-authorization-section`, and `components/tool-settings-panel`: Popover content sections.
- `hooks/use-tool-selector` and `hooks/use-plugin-installed-check`: Selector state and installed-provider resolution.

## External Modules

- `app/components/plugins/plugin-auth`: Tool authorization controls.
- `app/components/plugins/readme-panel`: Plugin documentation entry.
- `app/components/tools`: Tool provider contracts and form conversion.
- `app/components/workflow/block-selector`: Tool picker and selected-tool contracts.
- `app/components/workflow/nodes/_base/components`: MCP availability and plugin recovery actions.
- `service/use-plugins` and `service/use-tools`: Installed plugin and tool-provider queries.
