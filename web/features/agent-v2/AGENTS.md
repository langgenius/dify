## Agent V2 Frontend

- Keep Agent V2 separate from legacy workflow Agent. Use `web/features/agent-v2`, `web/app/components/workflow/nodes/agent-v2`, the `agent_node_kind: 'dify_agent'` and `version: '2'` payload discriminator, and `BlockEnum.AgentV2` where the graph type is already migrated. Do not bridge Agent V2 to legacy `agent_strategy_*` behavior or data shapes.
