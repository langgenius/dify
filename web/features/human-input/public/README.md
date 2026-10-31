# Public Human Input Form

Public v2 Email OTP session orchestration and generated API transport within the
[Human Input feature]. The `/form-v2/[token]` route composes this
owner. All runtime environments use the real adapter; mocks require explicit
test injection.

## Internal Modules

| Module               | Responsibility                                                                     |
| -------------------- | ---------------------------------------------------------------------------------- |
| `types`              | Defines v2 definition, challenge, submit, upload, and transport contracts.         |
| `errors`             | Normalizes transport failures into redacted UI categories.                         |
| `transport-selector` | Selects real or mock transport without URL or failure-based fallback.              |
| `upload`             | Adapts the v2 transport to the generic upload strategy at the form owner.          |
| `legacy-upload`      | Adapts legacy form-scoped uploads for the existing `/form/[token]` route.          |
| `real-transport`     | Maps generated public v2 definition, challenge, submission, and upload-token APIs. |
| `mock-transport`     | Provides deterministic, explicitly injected test behavior.                         |
| `session-reducer`    | Enforces the local OTP and Challenge session lifecycle.                            |
| `use-form-session`   | Owns route-session effects, deadlines, stale-response protection, and mutations.   |
| `form`               | Composes shared form presentation with v2 verification UI and status states.       |

## External Modules

| Module                              | Why this feature uses it                                                |
| ----------------------------------- | ----------------------------------------------------------------------- |
| [Shared form]                       | Reuses normalized form presentation primitives.                         |
| `app/components/base/file-uploader` | Accepts the owner-provided upload strategy through `FileUploadContext`. |

## Backend Dependencies

- The real transport consumes the generated public v2 form-definition,
  access-request, submission, and upload-token operations through
  `service/human-input-v2`; API failures never fall back to mock forms or legacy
  v1 operations.
- Generated aggregate routing collides for `human-input` and `human_input`. The
  service client selects the generated hyphenated v2 operations explicitly, and
  transport tests assert those request paths.
- Public uploads request form-scoped authorization before transferring local or
  remote files. Do not send v2 form tokens to legacy upload operations.
- Public form owners supply upload strategies; generic upload components do not
  read form routes, tokens, versions, or authentication transports. Legacy and v2
  failures retain their protocol and never fall back to another upload adapter.
- Human Input v2 mail messages must link to `/form-v2/<form_token>`.
- End-to-end mail, resend, expiry, submission, and upload verification requires a
  backend that implements those operations and a real issued form token.

[Human Input feature]: ../README.md
[Shared form]: ../form/README.md
