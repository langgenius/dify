# Dify Builder

In-editor App Builder UI and session logic for the Build, Edit, and Fix APIs.

## Internal Modules

- `panel.tsx`: panel composition, conversation scrolling, and shared interaction
  coordination. `panel/` owns the header, background, empty state, action bar,
  and footer.
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
while `at_version` lets the matching commit clear transient progress.

`workflow` envelopes carry the complete native debugger payload alongside
Builder's session, operation, stage, version, and revision metadata. Accepted
payloads dispatch directly to the editor's shared `useWorkflowRunEvent`
callbacks, including node, retry, iteration, loop, text, agent log, human-input,
pause, and terminal events. An inner workflow `error` or `workflow_finished`
does not terminate the outer Builder command. Chatflow message/text events
without a run ID use the run started in the same command, with native message
chunks and replacements handled by the shared text callbacks. Complete live runs need no
subsequent detail or node-execution queries. Those queries use persisted test
cards' `dify_run_id` only when reopening history or recovering missing events;
Builder-internal `run_ids` are never used. Native execution status remains
authoritative over Builder validation cards. An interrupted run clears live
animation without inventing a failed result. Canvas refresh completion reapplies
saved runtime fields directly, without rebuilding the live run from node rows.

Builder executes the native workflow generator inside its existing worker task
while retaining streaming callbacks. It does not enqueue a child workflow task
and wait for another Celery pool slot: a worker consuming both queues at
concurrency 1 would otherwise deadlock until the stream times out.

Build/Edit repair approval commits the changed graph and stops at
`build.execution` / `edit.apply_changes`. The initiating client waits for that
session version's canvas refresh to succeed, then submits one `run_test` /
`run_affected_tests` action with the matching session and app revisions. The
pending retest is cleared on reset, restore, another command, or a version
conflict; reopening historical waiting states never starts a test. A failed
refresh leaves the test pending until a successful retry. This separates graph
application from execution, so even newly created nodes exist before their
first workflow callback runs.

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
