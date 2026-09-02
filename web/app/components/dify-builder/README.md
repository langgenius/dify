# Dify Builder

Shared session/stream logic for the in-editor App Builder Build, Edit, and Fix
APIs.

## Internal Modules

- `state.ts`: primitive session atoms. Feature consumers scope these atoms per
  tenant/user/app with `ScopeProvider`. Canvas consumers can subscribe to the
  latest canvas event atom without reading the bounded progress log.
- `use-dify-builder-session.ts`: the controller sends create, action, and
  message commands as POST SSE requests. Live views are updated from SSE:
  snapshots initialize the view, commits merge durable items,
  `agent_message` frames append assistant text deltas, and terminal state
  frames replace the view. GET is itself an SSE stream and is used to
  restore/recover a session. All four calls use the generated console contract
  client; response parsing and event typing come from that contract. The
  controller writes session atoms without subscribing to them;
  `useDifyBuilderSession` is the read-and-write wrapper for consumers that also
  need the current session state.

The browser persists only an unfinished session id in `sessionStorage`, under
`dify-builder:v1:{tenantId}:{userId}:{appId}:active-session-id`. Conversation,
status, versions, and streamed text are never written to browser storage.

Keep UI-only state, such as composer drafts and expanded cards, in the owning
component. Add derived atoms for shared fields instead of passing the complete
`SessionView` through React Context.

## External Modules

- `@/service/client`: generated `consoleClient` methods for the four typed SSE
  operations. The shared client owns authentication and CSRF behavior.
