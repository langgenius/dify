# Dify Builder

In-editor App Builder UI and session logic for the Build, Edit, and Fix APIs.

## Internal Modules

- `session/`: scoped session atoms, pure projection helpers, the SSE lifecycle
  controller, an animation-frame buffer for assistant text deltas, and a
  low-frequency live-progress projection.
- `conversation/`: conversation grouping and focused card components. Only the
  streaming assistant tail subscribes to token updates, so committed history
  and form cards do not rerender for every delta.
- `provider/`: session persistence and canvas synchronization boundaries.
- `store.ts`: derived feature state and UI commands.

The controller restores bounded session state with JSON GET and loads durable
conversation groups through a separate paginated JSON GET. Create, action, and
message commands use typed POST SSE requests; an independent GET SSE route is
opened only while reconnecting to an active command. SSE never carries full
history: `command_started` is a bounded handshake, commits append durable items,
and terminal state frames replace session metadata. A sequence gap is repaired
through the conversation GET. `agent_message` deltas stay outside durable
history until the server commits them. `progress` frames carry replaceable,
curated trace snapshots; `operation_id` and `revision` reject stale updates,
while `at_version` lets the matching commit clear transient progress. Node
events are folded into the active trace without exposing node errors.

Only `SessionView.active_interaction` is editable. Historical form and resource
cards are restored from conversation pages as read-only content; the active
card is also returned with bounded session state so it remains available when
it falls outside the latest history page. Unsubmitted field drafts remain local
component state and are intentionally not persisted.

The browser persists only an unfinished or restartable failed session id in `sessionStorage`, under
`dify-builder:v1:{tenantId}:{userId}:{appId}:active-session-id`. Conversation,
status, versions, and streamed text are never written to browser storage.

Keep UI-only state, such as composer drafts and expanded cards, in the owning
component. Add derived atoms for shared fields instead of passing the complete
`SessionView` through React Context.

## External Modules

- `@/service/client`: generated `consoleClient` methods for typed JSON and SSE
  routes. The shared client owns authentication and CSRF behavior.
