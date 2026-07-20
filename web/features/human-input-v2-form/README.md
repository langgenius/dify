# Human Input v2 Form

Route-owned Email OTP session orchestration and mock-first transport for the public Human Input v2 form.

## Internal Modules

| Module               | Responsibility                                                                   |
| -------------------- | -------------------------------------------------------------------------------- |
| `types`              | Defines v2 definition, challenge, submit, upload, and transport contracts.       |
| `errors`             | Normalizes transport failures into redacted UI categories.                       |
| `transport-selector` | Selects real or mock transport without URL or failure-based fallback.            |
| `transport-context`  | Exposes the selected transport to route descendants and upload fields.           |
| `transport`          | Provides the selected transport to the v2 presentation subtree.                  |
| `real-transport`     | Holds the canonical API boundary until generated contracts are ready.            |
| `mock-transport`     | Provides deterministic, instance-scoped development and test behavior.           |
| `session-reducer`    | Enforces the local OTP and Challenge session lifecycle.                          |
| `use-form-session`   | Owns route-session effects, deadlines, stale-response protection, and mutations. |
| `form`               | Composes shared form presentation with v2 verification UI and status states.     |

## External Modules

| Module                              | Why this feature uses it                               |
| ----------------------------------- | ------------------------------------------------------ |
| `features/human-input-form`         | Reuses normalized public-form presentation primitives. |
| `app/components/base/file-uploader` | Uses the transport-provided v2 upload strategy.        |

## Real Adapter Handoff

- Confirm the finalized Challenge Token, OTP request/submit field names, OTP shape, cooldown/expiry units, and public error codes.
- Confirm the canonical form-definition DTO, including resolved defaults, ordered actions, expiration, and optional branding.
- Confirm the canonical upload-token response, authenticated file-upload endpoint, and local/remote file response DTOs.
- Add the generated public-client contracts and map DTOs only inside `real-transport`.
- Ensure Human Input v2 mail messages link to `/form-v2/<form_token>`.
- Run mock/real contract-parity fixtures plus end-to-end mail, resend, expiry, submit, and upload verification before enabling the real adapter.
