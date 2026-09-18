## Why

Human Input v2 now has a public Email-proof page, but workspace and Platform contacts still lack the separate Dify-session-authenticated page their approval grants require. The frontend also needs one canonical direct-link contract that survives sign-in and returns the approver to the correct Contact surface without inferring identity or falling back to Email OTP.

## What Changes

- Add a dedicated frontend route at `/form-v2/contact/<form_token>` for workspace and Platform contacts whose delivery has `auth_type=console`.
- Load, render, upload, validate, and submit the resolved Human Input v2 form through a feature-owned authenticated console transport, reusing version-neutral form presentation while omitting Email OTP and Challenge Token state.
- Preserve the full same-origin Contact approval URL through Dify sign-in and return the user to the original token after authentication.
- Define one canonical frontend Contact approval link builder and route classifier so direct links and file uploads select the authenticated Contact surface explicitly.
- Reject public Email tokens, unavailable grants, and wrong-account access without switching to `/form-v2/<form_token>` or calling public Email endpoints.
- Consume only generated `consoleClient` / `consoleQuery` operations for the v2 console contract. If those operations are not yet generated, transport integration remains blocked rather than introducing handwritten REST helpers, DTO mirrors, runtime mock data, or v1 endpoint reuse.
- Add focused route, authentication-redirect, form-state, upload, transport, and locale tests, with new user-facing copy limited to `en-US` and `zh-Hans`.
- Keep this change frontend-only. Backend controllers, delivery persistence, `auth_type` selection, server-side message-link generation, mail/IM delivery, and generated API contracts are dependencies and are not modified here.

## Capabilities

### New Capabilities

- `human-input-v2-authenticated-contact-form-page`: Authenticated workspace/Platform Contact form loading, rendering, upload, submit, terminal states, and strict separation from the public Email-proof page.
- `human-input-v2-authenticated-contact-link-routing`: Canonical Contact approval URL construction, direct-link entry, Dify sign-in return handling, and route-aware transport selection.

### Modified Capabilities

None. The existing `human-input-runtime-form-api` capability remains the backend contract dependency; this change adds only its frontend consumer and link-entry behavior.

## Impact

- Affects a new route under `web/app/(humanInputLayout)/form-v2/contact/`, a new authenticated Contact form feature boundary, shared Human Input v2 presentation/domain utilities, console request composition, file-upload route classification, focused tests, and `en-US`/`zh-Hans` share locales.
- Depends on generated hyphenated console operations under `/console/api/form/human-input/<form_token>` for definition, upload-token, and submit. Tests mock that generated client boundary; no `access-request`, `otp_code`, or `challenge_token` is used.
- Uses the opaque `form_token` as a pass-through capability. The frontend does not inspect `recipient_id`, `auth_type`, `target_snapshot`, email, Contact type, or current account to choose an authorization surface.
- Does not modify `api/`, `packages/contracts/generated/`, backend OpenAPI schemas, workflow runtime, delivery/link generation, the public `/form-v2/<form_token>` Email flow, or legacy `/form/<form_token>` behavior.
