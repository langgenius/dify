# Contacts Management

This frontend-only feature owns the `/contacts` directory, contact details,
External contact creation, EE Add from Platform selection, removable-contact
selection, the External-to-Workspace Contact confirmation composed into member
invitations, and the narrow Contacts impact composed into active-member removal.

All data and mutations currently flow through `ContactsManagementRepository` and
the deterministic in-memory adapter in `mock/`. Components must not call member,
Contact, or Platform-contact APIs until a later backend-contract change replaces
the adapter. Add from Platform is modeled only with available Platform-contact
types and names. The sibling `contacts/im-platform` feature intentionally keeps an
independent repository and shares only workspace/deployment shell context.

When a member invitation or selected Platform contact exactly matches an
External Contact email, the owning workflow pauses before mutation. Confirming
the dialog upgrades only the mock Contact type while preserving its Contact ID,
workflow references, history, and remaining identity fields.
