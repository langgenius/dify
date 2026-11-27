# Skills

Workspace Skill management owns list actions, file editing, publishing, and
version restoration. Routes enter through the list page and the keyed detail
route; changing Skill identity creates a new detail session.

The detail session owns one shared draft mutation queue. File operations,
metadata changes, and tag changes must serialize against the same latest
`updated_at` snapshot. Splitting the UI must not give those flows independent
queues. Successful writes update the detail and list caches together; conflict
recovery reads an authoritative detail snapshot.

File operations, Markdown editing, Builder conversations, publishing, and version
restoration own their local behavior. Read-only reference presentation is shared
within this feature rather than imported from one route's internals.

Other features consume Skills permissions and error interpretation. They do not
compose the detail editor from internal components or mutation/cache helpers.
