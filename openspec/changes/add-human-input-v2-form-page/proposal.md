## Why

Human Input v2 needs a standalone public form surface that follows its Email OTP and Challenge Token authorization flow without changing the legacy `/form/<form_token>` experience. The backend v2 runtime endpoints are not complete yet, so the frontend needs an isolated mockable transport boundary that allows the page and its state transitions to be implemented and verified now, then switched to the real contract later.

## What Changes

- Add a new public route at `/form-v2/<form_token>` for Human Input v2 while preserving `/form/<form_token>` and all legacy request behavior.
- Load the v2 form definition from the canonical `/api/form/human-input/<form_token>` contract and render the existing version-neutral form content, inputs, actions, expiration, branding, and terminal states.
- After a valid form loads, request Email OTP exactly once through `POST /api/form/human-input/<form_token>/access-request`, retain the returned Challenge Token only in page memory, and expose server-driven resend and expiry behavior.
- Submit `inputs`, the selected `action`, `otp_code`, and `challenge_token` together through `POST /api/form/human-input/<form_token>`, with duplicate-submit protection and recoverable OTP/challenge errors.
- Extend Human Input file handling for `/form-v2/<form_token>` and the canonical v2 upload-token path without regressing legacy uploads.
- Introduce a typed, feature-owned transport interface with development/test mock implementations for form load, OTP delivery, Challenge Token lifecycle, submit, upload, cooldown, expiry, and error cases that are currently blocked by backend stubs. Production MUST NOT silently fall back to mock data.
- Add focused frontend tests and new user-facing translations in English and Simplified Chinese only.

## Capabilities

### New Capabilities

- `human-input-v2-public-form-page`: Route, load, render, validate, upload, submit, and present status/error states for the isolated Human Input v2 public form page.
- `human-input-v2-email-challenge`: Manage automatic Email OTP request, Challenge Token lifetime, resend cooldown, secure in-memory proof state, and OTP-guarded submission through a replaceable real/mock transport.

### Modified Capabilities

None. The repository currently has no matching main OpenSpec capability to modify.

## Impact

- Affects the `web/app/(humanInputLayout)/form-v2/` route, reusable public Human Input form presentation, feature-owned service/query code, Human Input file-upload route detection, focused tests, and `en-US`/`zh-Hans` share locales.
- Consumes the planned canonical public contracts under `/api/form/human-input/`; the expected access response includes `challenge_token`, `resend_after_seconds`, and `expires_in_seconds`, and submit includes both `otp_code` and `challenge_token`.
- Uses mock adapters and fixtures while the canonical GET/POST, access-request, Challenge Token fields, and upload-token contract are unavailable. Replacing those mocks with the finalized backend/generated contract is explicitly deferred but requires no page-state redesign.
- Does not implement backend endpoints, Email delivery, OTP verification, link generation, generated API contract edits, Human Input node/editor changes, or any behavior change to the legacy `/form/<form_token>` route.
