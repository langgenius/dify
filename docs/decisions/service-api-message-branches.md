# Service API message branches

Status: proposed implementation for #36395; pending maintainer review.

## Contract

Advanced Chat clients may send `parent_message_id` to `POST /chat-messages`.
Omission retains the legacy linear-history behavior. An explicit null starts a
new root in an existing conversation; an explicit message ID continues that
turn. An edited question is a new turn under the original question's predecessor,
with its own answer, message ID, workflow run and normal usage charges. No old
turn or descendant is rewritten or deleted. Clients supply query, inputs and
files using the existing request contract; attachment omission/reuse is not a
new server-side operation in this first slice.

The selection requires an existing Advanced Chat app and conversation belonging
to the admitted tenant, app and end user. Every selected ancestor has the same
owner chain. Missing references and cycles fail closed. Historical API rows with
the nil parent sentinel use the preceding chronological row, with ID as a stable
tie-breaker. A selection with more than 500 ancestors is rejected rather than
silently truncating the branch's dialogue count. Omitted-field legacy calls keep
their existing behavior. The nil UUID is not a client-selectable parent; select an actual turn
or null instead.

The application resolves the history both before enqueueing and after the worker
restores the request. It passes the resolved IDs explicitly through the generate
entity and graph run context into memory. A memory read loads those exact IDs,
in their selected order, rather than consulting the most recent conversation
row. This avoids cross-branch history when another run creates a newer row and
survives serialization and Human Input resume. Deleted ancestors cause failure,
never fallback to another branch. Short read transactions contain no model I/O.

## State and concurrency

This operation branches the transcript only. It uses the current published
workflow and current conversation variables, as normal Chatflow invocation does.
It does not restore historical variable values, revoke prior external effects,
or make tool execution idempotent. Concurrent generations retain independent
transcript selections; conversation variables remain shared, so this is not a
claim of isolated concurrent workflow-state updates. A client that needs
sequential variable mutations must serialize its conversation requests.

Graphs containing new Dify Agent workspace nodes are rejected before enqueueing.
Their independently persisted Agent sessions do not yet support transcript
branching. Plugin Agent nodes and LLM-backed nodes use the selected memory.

Generation, streaming, cancellation, error recording and billing continue through
the existing generation path. A failed new turn may remain recorded, but the old
branch stays available. Each accepted call is a new generation; there is no
automatic retry of a possibly accepted request.

## Structure and validation

The application service owns input policy and declares a scoped history port.
The existing message repository implements the port using bounded database reads;
the composition root wires it. Existing execution-kernel changes only carry the
resolved selection into node memory; no new business implementation lives there.
Import contracts keep the new application service free of ORM/framework imports.

Validation covers real scoped repository reads, roots and middle turns, legacy
linear rows, foreign/missing/cyclic ancestors, exact prompt history despite newer
branches, serialized selections, explicit-null versus omitted request fields,
and unchanged default memory. OpenAPI artifacts are generated from the schema
owner. Actual command results are recorded in the PR, not assumed by this ADR.

## Follow-ups

A dedicated regenerate endpoint can add server-side question/attachment reuse.
Historical workflow-state restoration needs its own snapshot and side-effect
contract; it is deliberately outside this first implementation.
