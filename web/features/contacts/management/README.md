# Contacts Management

This frontend feature owns the `/contacts` directory, contact details,
External contact creation, EE Add from Platform selection, removable-contact
selection, the External-to-Workspace Contact confirmation composed into member
invitations, and the narrow Contacts impact composed into active-member removal.

## Release Gate

`NEXT_PUBLIC_ENABLE_HITL_IM` defaults to `false`. Set it to `true` and restart
Web to expose the Contacts navigation and route, workspace IM channel settings,
and contact-aware member interactions. Reload the browser after restarting.
This gate is independent of `NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW` and does not
change `im_centrally_managed`, which determines where IM configuration is managed.
When off, the editor creates legacy V1 Human Input nodes, hides migration UI,
and blocks V2 insertion, contact selection, message templates and IM debug UI.
Existing V2 nodes keep their original data and show an unavailable state; they
are not converted to V1. V1 editing and forms remain available. New V2 approval
routes and `/contacts` return not found while disabled.

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
