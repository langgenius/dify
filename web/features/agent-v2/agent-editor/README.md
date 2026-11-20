# Agent editor

Agent routes, Workflow nodes, and template previews share configuration behavior.
`agent-composer` remains the single owner of the editable draft; the editor owns
its configuration, preview, and persistence sessions.

Workflow owns graph bindings, node creation, dialog placement, and saving an
inline Agent to the roster. It passes resource identity and binding callbacks
into the editor instead of assembling editor state and presentation itself.
Workflow also owns graph-variable discovery. Its metadata filter subscribes only
when the corresponding knowledge controls mount; standalone editing does not
require a Workflow graph scope.

Roster and inline sessions retain separate scopes and stable session keys.
Closing a surface, switching Agent identity, or viewing a version must preserve
the existing draft and conversation lifetimes. Server data stays in TanStack
Query; sharing an editor must not introduce another configuration store.
