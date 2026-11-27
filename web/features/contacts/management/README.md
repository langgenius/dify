# Contacts Management

This feature owns the `/contacts` directory, contact details, external-contact
creation and editing, platform-directory imports, and removable-contact selection.
Members with `contact.view` or `contact.manage` can browse the directory.
Contact changes require `contact.manage`. The runtime provider reads these
workspace permissions and the `im_centrally_managed` capability.

Components use generated `consoleQuery` query and mutation options directly.
Shared mutation policies own cache invalidation. Contact and directory data keep
the generated API shape, including nullable or omitted email and avatar fields.
Tests stub the generated transport responses while preserving query keys,
mutation policies, and production pagination behavior.

`NEXT_PUBLIC_ENABLE_HITL_IM` is the independent, default-on release gate. The
`im_centrally_managed` capability determines whether platform imports and
organization-managed bindings are available. In centrally managed mode contact
details do not request workspace channel-management endpoints.

External-contact and platform-picker drafts, search, selection, and mutations
live inside each dialog content session. They remain visible throughout closing
transitions, reset after unmount, and survive failed submissions for correction.
Server duplicate-email errors belong to the email field.

Platform candidates are paginated by the backend and resolved against existing
contacts through the generated batch operation. The available-candidates query
orchestrates those generated operations and skips fully imported pages until a
selectable contact, terminal page, or request error is reached. It keeps underlying
pages in their generated caches, isolates workspace/search identities, and stops
on cancellation or non-progressing pagination. Only search and contact-type
filters are shareable URL state; loaded page count is local query state.

Member invitations and member removal use their existing generated workspace
member operations. Enterprise member removal can keep the same Contact as a
Platform Contact in the current workspace.
