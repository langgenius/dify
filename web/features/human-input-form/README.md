# Human Input Form

Version-neutral domain and presentation primitives for public Human Input forms.

## Internal Modules

| Module                        | Responsibility                                                      |
| ----------------------------- | ------------------------------------------------------------------- |
| `types`                       | Defines the normalized form definition and legacy transport shape.  |
| `normalize-legacy-definition` | Maps the legacy response into the shared domain model.              |
| `loaded-form-content`         | Renders fields, actions, expiration, branding, and verification UI. |
| `form-status-card`            | Renders terminal and completion states.                             |
| `branding-footer`             | Renders optional Dify or custom branding.                           |

## External Modules

| Module                                                     | Why this feature uses it                                 |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `app/components/base/chat/chat/answer/human-input-content` | Reuses Human Input field rendering and value processing. |
| `app/components/workflow/nodes/human-input`                | Reuses form-input and action domain types.               |
| `models/share`                                             | Reuses public application branding types.                |
