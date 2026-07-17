# Contacts Management

This frontend-only feature owns the `/contacts` directory, contact details,
External contact creation, EE Organization candidate selection, and the narrow
Contacts impact composed into active-member removal.

All data and mutations currently flow through `ContactsManagementRepository` and
the deterministic in-memory adapter in `mock/`. Components must not call member,
Contact, or Organization APIs until a later backend-contract change replaces the
adapter. The sibling `contacts/im-platform` feature intentionally keeps an
independent repository and shares only workspace/deployment shell context.
