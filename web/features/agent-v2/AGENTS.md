## Agent V2 Frontend

- Keep Agent V2 separate from legacy workflow Agent. Use `web/features/agent-v2`, `web/app/components/workflow/nodes/agent-v2`, the `agent_node_kind: 'dify_agent'` and `version: '2'` payload discriminator, and `BlockEnum.AgentV2` where the graph type is already migrated. Do not bridge Agent V2 to legacy `agent_strategy_*` behavior or data shapes.
- `agent-composer` owns editable Agent configuration state. `agent-editor` composes that state with server synchronization, build draft commands, preview chat sessions, version viewing, and workspace panels; it must not create a second configuration store.
- Configure overlays stay with the feature component that owns the interaction and compose Dify UI primitives.

- `agent-editor/roster-page.tsx` owns route configuration; `roster-panel.tsx` and `workflow-panel.tsx` own Workflow editor surfaces. Workflow hosts pass resource identity and binding callbacks instead of assembling editor internals. Template preview composes the configuration surface.
