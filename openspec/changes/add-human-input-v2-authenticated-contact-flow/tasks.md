## 1. Canonical Contact Link and Route Contract

- [ ] 1.1 Add failing unit tests for building `/form-v2/contact/<form_token>` with one encoded token segment and no identity, tenant, email, or `auth_type` parameters.
- [ ] 1.2 Add failing route-classifier tests that distinguish legacy, public v2, authenticated Contact v2, base-path-prefixed, malformed, and unrelated paths.
- [ ] 1.3 Implement the shared Contact approval path builder and extend the Human Input route classifier with an explicit authenticated Contact v2 kind without changing legacy or public v2 results.
- [ ] 1.4 Add route-entry tests proving `/form-v2/contact/[token]` resolves directly from an external message link while `/form-v2/[token]` continues resolving to the public Email page.

## 2. Sign-in Return and Surface Isolation

- [ ] 2.1 Add regression tests proving a console 401 on the Contact route builds `/signin?redirect_url=...` with the complete same-origin Contact path and opaque token preserved.
- [ ] 2.2 Add post-login redirect tests proving a valid internal Contact return target is restored and unsafe external redirect targets remain rejected.
- [ ] 2.3 Add cross-surface tests proving 403, 404, wrong-account, wrong-surface, unavailable, and retry paths never navigate to `/form-v2/<form_token>`, call the public v2 client, or request Email OTP.
- [ ] 2.4 Add token-confidentiality tests proving Contact tokens do not enter analytics, logs, browser storage, persisted query data, identity lookups, or user-visible error diagnostics.

## 3. Shared V2 Presentation and Upload Boundary

- [ ] 3.1 Characterize the existing legacy and public v2 form behavior before refactoring shared definition, presentation, error, or upload primitives.
- [ ] 3.2 Extract only OTP-independent Human Input v2 domain mapping, status presentation, and upload capability contracts needed by both public and authenticated pages; keep Email Challenge state inside the public feature.
- [ ] 3.3 Narrow the shared file-uploader integration to a surface-specific upload capability so an authenticated Contact route cannot receive the public v2 transport by default.
- [ ] 3.4 Run the affected legacy and public v2 suites after the extraction and prove their endpoints, OTP sequence, payloads, statuses, and uploads remain unchanged.

## 4. Generated Console Client Integration

- [ ] 4.1 Confirm externally generated `consoleQuery` / `consoleClient` operations exist for hyphenated v2 definition GET, upload-token POST, and submit POST before starting integration; if absent, leave this and dependent tasks pending without adding a handwritten, legacy, public, generated-file, or runtime-mock workaround.
- [ ] 4.2 Map the generated console definition response into the existing version-neutral `HumanInputFormDefinition` without adding a local transport DTO mirror.
- [ ] 4.3 Add generated-client-backed query and mutation composition for definition, upload-token, and submit, including abort/stale-response support and normalized frontend errors.
- [ ] 4.4 Add focused client-boundary tests for exact token parameters and `{ inputs, action }` submit payloads, proving no `access-request`, `otp_code`, `challenge_token`, public endpoint, or underscore endpoint is used.
- [ ] 4.5 Add error-mapping tests for unauthorized redirect, forbidden/wrong account, not found, expired, already submitted, rate limited, upload failed, network/unavailable, and unknown responses without exposing raw transport details.

## 5. Authenticated Contact Form Page

- [ ] 5.1 Create `web/app/(humanInputLayout)/form-v2/contact/[token]/` with the focused standalone form shell and a route-owned feature composition keyed by the current token.
- [ ] 5.2 Implement Contact form lifecycle ownership for loading, ready, submitting, recoverable error, terminal, and success states with no OTP, Challenge Token, resend timer, or access-request effect.
- [ ] 5.3 Load the definition only through the generated console query and render resolved content, defaults, ordered actions, expiration, optional branding, loading, and no-branding states through shared presentation.
- [ ] 5.4 Reset values, errors, success, uploads, and pending state when the route token changes, and ignore or abort definition/submit responses for the previous token.
- [ ] 5.5 Render localized not-found, forbidden/wrong-account, expired, already-submitted, rate-limit, unavailable, and unknown states; expose retry only for recoverable console requests.

## 6. Account-Session Submission

- [ ] 6.1 Add failing feature tests for action enablement across required-field validity, definition pending, submit pending, terminal, and success states without any OTP control.
- [ ] 6.2 Process shared form values and send exactly `{ inputs, action }` through the generated console mutation, leaving Account-to-Contact grant validation entirely to the server.
- [ ] 6.3 Add one pending lock across all action buttons and tests proving rapid or different action clicks create exactly one console submit request.
- [ ] 6.4 Preserve form values for recoverable failures, enter terminal state for expired/completed responses, and clear mutable state before displaying success.
- [ ] 6.5 Add negative payload tests proving the page never sends recipient identity, Contact type, email, `auth_type`, `otp_code`, or `challenge_token`.

## 7. Authenticated Contact File Upload

- [ ] 7.1 Connect the authenticated Contact route kind to the generated console upload-token operation through the surface-specific upload context.
- [ ] 7.2 Add integration tests proving local and remote Contact-page uploads use only the authenticated console strategy while public v2, legacy, and unrelated routes keep their existing strategies.
- [ ] 7.3 Add token-change tests proving late upload-token or file responses from a previous Contact route cannot update the current form.
- [ ] 7.4 Normalize Contact upload failures into localized recoverable feedback without retrying through public or legacy upload endpoints.

## 8. Localization, Handoff, and Verification

- [ ] 8.1 Add authenticated approval, wrong-account/access-denied, retry, unavailable, and status strings to `web/i18n/en-US/share.json` and `web/i18n/zh-Hans/share.json` only.
- [ ] 8.2 Add locale tests proving every new English and Simplified Chinese string resolves with no hardcoded user-facing copy or English fallback in `zh-Hans`.
- [ ] 8.3 Document `/form-v2/contact/<form_token>` as the required message-link target for backend deliveries with `auth_type=console`, explicitly leaving server-side link generation and delivery selection outside this change.
- [ ] 8.4 Run focused unit/RTL suites for route construction, classifier, sign-in return, generated-client mapping, Contact page, submit, upload, locales, public v2 regressions, and legacy regressions with no real network requests.
- [ ] 8.5 Run targeted formatting, Oxlint/ESLint, accessibility, and TypeScript checks for changed frontend files, then run `pnpm check` and document only unrelated pre-existing failures.
- [ ] 8.6 Audit the final diff to prove it contains only `web/` plus this OpenSpec change and includes no `api/`, backend schema, generated contract, workflow runtime, message-delivery, public v2 behavior, or legacy form behavior changes.
