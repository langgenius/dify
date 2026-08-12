# Member Invitations

Owns the workspace member invitation form, including email recipient composition, role selection, submission errors, and invitation request state.

Base UI Form owns field registration, validation, external field errors, and invalid-field focus. TanStack Query owns invitation mutation state. This module keeps only the controlled email composition value and business submission outcome.

## Internal Modules

None.

## External Modules

| Module                                       | Why this module uses it                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| `@dify/contracts/api/console/workspaces`     | Types invite responses and documented invite error codes.     |
| `context/i18n`                               | Provides the current locale for role queries and invitations. |
| `context/provider-context`                   | Provides workspace seat limits and refresh capability.        |
| `models/access-control`                      | Types workspace role options.                                 |
| `service/access-control/use-workspace-roles` | Loads paginated role options.                                 |
| `service/client`                             | Executes the invitation mutation.                             |
| `service/use-common`                         | Invalidates member list queries after a successful invite.    |
