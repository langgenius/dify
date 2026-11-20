# Agent editor

The editor owns Agent configuration surfaces shared by the Agent detail route,
Workflow Agent V2 nodes, and template previews. It composes `agent-composer`, which
remains the single owner of editable Agent configuration state.

## Entry points

- `roster-page.tsx`: route configuration, including URL mode, permissions, selected
  versions, and the roster editing session.
- `roster-panel.tsx`: read-only configuration for a Workflow roster binding.
- `workflow-panel.tsx`: inline Workflow editing, build-draft actions, preview
  conversations, working-directory panels, and the session's scoped state.
- `configuration/`: configuration fields and their interaction owners, also used by
  template previews. `preview/` owns conversation and working-directory presentation.
- `workflow-sync.ts`: inline composer persistence. The host supplies resource
  identity; the editor does not read Workflow graph state or update node bindings.

Workflow node hosts own graph bindings, node creation, dialog placement, and
saving an inline Agent to the roster. They pass identity and completion callbacks
through the editor surfaces instead of assembling configuration internals.

`roster-session.tsx` owns roster synchronization and build/preview coordination.
Its session, the inline editor session, and the composer scopes retain their
existing mount lifetimes and cache identities. Shared server data remains in
TanStack Query; this module does not introduce another configuration store.
