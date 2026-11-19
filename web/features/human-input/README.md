# Human Input

Human Input approval forms are one feature with shared presentation and separate
public and authenticated Console session owners. Form versions remain protocol
concerns inside the appropriate owner rather than top-level feature folders.

| Owner     | Responsibility                                           | Entry points                                                |
| --------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| [form]    | Shared definitions, field rendering, status and branding | `form/loaded-form-content.tsx`, `form/form-status-card.tsx` |
| [public]  | Public v2 Email OTP session and generated API transport  | `public/form.tsx`                                           |
| [console] | Signed-in approval session and Console link resolution   | `console/form.tsx`, `console/links.ts`                      |

The legacy `/form/[token]` route consumes shared presentation while retaining its
existing transport. `/form-v2/[token]` and `/human-input/[formToken]` compose the
public and Console owners respectively. Workflow previews also consume shared
form presentation; they do not own public verification or Console authentication.

Public form owners bind their token and transport to the shared uploader's
`FileUploadContext.uploadStrategy`. Initial uploads, clipboard uploads and retries
use the same local strategy; URL uploads use its remote strategy. The generic
uploader does not inspect Human Input routes or import approval session internals.

Import the concrete owner that provides the capability. This feature does not
provide a root barrel that merges the route sessions or their auth lifetimes.

[console]: ./console/README.md
[form]: ./form/README.md
[public]: ./public/README.md
