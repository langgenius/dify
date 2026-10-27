# Contacts Management

This frontend feature owns the `/contacts` directory, contact details,
External contact creation, EE Add from Platform selection, removable-contact
selection, the External-to-Workspace Contact confirmation composed into member
invitations, and the narrow Contacts impact composed into active-member removal.

Runtime data and mutations flow through `ContactsManagementRepository` and its
Console API adapter, composed by `ContactsManagementRuntimeProvider`. The
deterministic in-memory adapter in `__tests__/fixtures/` is used only by tests.
Components use the repository rather than calling Contact APIs directly. Add
from Platform selects available Platform contacts. The sibling
`contacts/im-platform` feature keeps an independent repository and shares only
workspace/deployment shell context.

When a member invitation or selected Platform contact exactly matches an
External Contact email, the owning workflow pauses before mutation. Confirming
the dialog upgrades the Contact type while preserving its Contact ID,
workflow references, history, and remaining identity fields.
