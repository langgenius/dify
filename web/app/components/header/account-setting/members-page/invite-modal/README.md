# Member Invitations

This module owns the workspace member invitation form: recipient composition, role selection, field and form errors, request state, the successful invitation result, and coordination with the feature-preview Contacts upgrade confirmation.

Base UI Form owns registration, validation, external field errors, and invalid-field focus. TanStack Query owns feature and role queries, the invitation mutation, and cache invalidation. Seat availability comes from `consoleQuery.features.get`; the feature does not mirror it in local or provider state.

`InviteForm` owns the email draft, parsed recipients, pending Contacts upgrade confirmation, and current submission error. Colocated presentation components may own their transient interaction state; dialog visibility remains caller-owned.
