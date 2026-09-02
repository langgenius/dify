# Dify Builder

In-editor App Builder UI and session logic for the Build, Edit, and Fix APIs.

## Internal Modules

- `session/`: scoped session atoms, pure projection helpers, the SSE lifecycle
  controller, and an animation-frame buffer for assistant text deltas.
- `conversation/`: conversation grouping and focused card components. Only the
  streaming assistant tail subscribes to token updates, so committed history
  and form cards do not rerender for every delta.
- `provider/`: session persistence and canvas synchronization boundaries.
- `store.ts`: derived feature state and UI commands.

The controller sends create, action, and message commands as typed POST SSE
requests. Snapshots initialize the view, commits merge durable items, and
terminal state frames replace it. `agent_message` deltas stay outside the
durable `SessionView` until the server commits them. GET is itself an SSE stream
and is used to restore or recover a session.

The browser persists only an unfinished session id in `sessionStorage`, under
`dify-builder:v1:{tenantId}:{userId}:{appId}:active-session-id`. Conversation,
status, versions, and streamed text are never written to browser storage.

Keep UI-only state, such as composer drafts and expanded cards, in the owning
component. Add derived atoms for shared fields instead of passing the complete
`SessionView` through React Context.

## External Modules

- `@/service/client`: generated `consoleClient` methods for the four typed SSE
  operations. The shared client owns authentication and CSRF behavior.
