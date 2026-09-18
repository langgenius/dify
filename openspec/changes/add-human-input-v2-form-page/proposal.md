## Why

Human Input v2 needs a standalone public Email-proof form surface that follows its Email OTP and Challenge Token authorization flow without changing the legacy `/form/<form_token>` experience. This public surface must remain isolated from the authenticated Contact approval flow used by workspace and Platform contacts. The backend v2 runtime endpoints are not complete yet, so the frontend needs an isolated mockable transport boundary that allows the page and its state transitions to be implemented and verified while preserving that authorization boundary.

## What Changes

- Add a new public route at `/form-v2/<form_token>` for External contacts, one-time Email recipients, and Dynamic Email grants that use Email proof, while preserving `/form/<form_token>` and all legacy request behavior.
- Keep workspace and Platform contacts out of `/form-v2`: their message links must target a separate authenticated approval page backed by `/console/api/form/human-input/<form_token>`, which is outside this change.
- Load the v2 form definition from the canonical `/api/form/human-input/<form_token>` contract and render the existing version-neutral form content, inputs, actions, expiration, branding, and terminal states.
- After a valid form loads, request Email OTP exactly once through `POST /api/form/human-input/<form_token>/access-request`, retain the returned Challenge Token only in page memory, and expose server-driven resend and expiry behavior.
- Submit `inputs`, the selected `action`, `otp_code`, and `challenge_token` together through `POST /api/form/human-input/<form_token>`, with duplicate-submit protection and recoverable OTP/challenge errors.
- Never choose between Dify-session and Email-OTP authentication from browser session state, email matching, query parameters, or public-token failure. A token rejected by the public Email API must remain rejected without redirecting or falling back to the authenticated Contact flow.
- Extend Human Input file handling for `/form-v2/<form_token>` and the canonical v2 upload-token path without regressing legacy uploads.
- Introduce a typed, feature-owned transport interface with development/test mock implementations for form load, OTP delivery, Challenge Token lifecycle, submit, upload, cooldown, expiry, and error cases that are currently blocked by backend stubs. Production MUST NOT silently fall back to mock data.
- Add focused frontend tests and new user-facing translations in English and Simplified Chinese only.

## Capabilities

### New Capabilities

- `human-input-v2-public-form-page`: Route, load, render, validate, upload, submit, and present status/error states for the isolated Human Input v2 public Email-proof form page without absorbing authenticated Contact approval.
- `human-input-v2-email-challenge`: Manage automatic Email OTP request, Challenge Token lifetime, resend cooldown, secure in-memory proof state, and OTP-guarded submission for Email-proof approvers through a replaceable real/mock transport.

### Modified Capabilities

None. The repository currently has no matching main OpenSpec capability to modify.

## Impact

- Affects the `web/app/(humanInputLayout)/form-v2/` route, reusable public Human Input form presentation, feature-owned service/query code, Human Input file-upload route detection, focused tests, and `en-US`/`zh-Hans` share locales.
- Consumes the planned canonical public contracts under `/api/form/human-input/`; the expected access response includes `challenge_token`, `resend_after_seconds`, and `expires_in_seconds`, and submit includes both `otp_code` and `challenge_token`.
- Uses generated public-client operations through the real adapter and deterministic mock adapters for frontend tests while the public controllers still return `501`; production never falls back to mock proof.
- Does not implement backend endpoints, Email delivery, OTP verification, surface-aware message-link generation, the authenticated Contact page or console runtime API, Human Input node/editor changes, or any behavior change to the legacy `/form/<form_token>` route.
