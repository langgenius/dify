# Human Input v2 Form

Route-owned Email OTP session orchestration and generated API transport for the public Human Input v2 form. All runtime environments use the real adapter; mocks require explicit test injection.

## Internal Modules

| Module               | Responsibility                                                                     |
| -------------------- | ---------------------------------------------------------------------------------- |
| `types`              | Defines v2 definition, challenge, submit, upload, and transport contracts.         |
| `errors`             | Normalizes transport failures into redacted UI categories.                         |
| `transport-selector` | Selects real or mock transport without URL or failure-based fallback.              |
| `transport-context`  | Exposes the selected transport to route descendants and upload fields.             |
| `transport`          | Provides the selected transport to the v2 presentation subtree.                    |
| `real-transport`     | Maps generated public v2 definition, challenge, submission, and upload-token APIs. |
| `mock-transport`     | Provides deterministic, explicitly injected test behavior.                         |
| `session-reducer`    | Enforces the local OTP and Challenge session lifecycle.                            |
| `use-form-session`   | Owns route-session effects, deadlines, stale-response protection, and mutations.   |
| `form`               | Composes shared form presentation with v2 verification UI and status states.       |

## External Modules

| Module                              | Why this feature uses it                               |
| ----------------------------------- | ------------------------------------------------------ |
| `features/human-input-form`         | Reuses normalized public-form presentation primitives. |
| `app/components/base/file-uploader` | Uses the transport-provided v2 upload strategy.        |

## Backend Dependencies

- The public v2 controllers currently return HTTP 501. These responses show an unavailable state; requests never fall back to mock forms or legacy v1 APIs.
- Generated aggregate routing collides for `human-input` and `human_input`. The shared client selects the generated hyphenated v2 operations explicitly, and transport tests assert those request paths.
- File transfer remains unavailable until the backend supports v2 upload authorization. The existing upload controller only resolves legacy forms; do not pass v2 tokens to it.
- Ensure Human Input v2 mail messages link to `/form-v2/<form_token>`.
- End-to-end mail, resend, expiry, submission, and upload verification requires implemented backend endpoints and a real issued form token.
