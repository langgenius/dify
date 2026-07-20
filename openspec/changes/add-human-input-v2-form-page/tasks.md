## 1. Legacy Baseline and Shared Presentation Boundary

- [x] 1.1 Add or tighten regression tests for `/form/<token>` form loading, processed input/action submission, success, not-found/expired/submitted/rate-limit states, branding, expiration, and file upload paths.
- [x] 1.2 Move public-form domain/presentation types out of the legacy route module so service code no longer imports `web/app/(humanInputLayout)/form/[token]/form.tsx`.
- [x] 1.3 Extract version-neutral loaded-form content, field/action rendering, branding, expiration, and status-card primitives behind explicit props while keeping version-specific hooks outside them.
- [x] 1.4 Run the legacy route suite after extraction and prove its underscore endpoints, payload, copy, and observable behavior remain unchanged.

## 2. V2 Domain, Transport, and Error Contracts

- [x] 2.1 Add frontend-local v2 form domain models for resolved definition, optional branding, access response, Challenge session, submit payload, upload token, and normalized error categories without editing generated API files.
- [x] 2.2 Define the narrow `HumanInputV2FormTransport` interface for get-form, access-request, submit, and upload-token operations, including abort/stale-response support where applicable.
- [x] 2.3 Add contract tests proving both real and mock adapters satisfy the same interface and map expected `challenge_token`, `resend_after_seconds`, `expires_in_seconds`, `otp_code`, and action/input fields.
- [x] 2.4 Implement centralized transport-error normalization for form terminal states, access delivery/rate limit, invalid OTP, stale/expired challenge, network/unavailable, and unknown errors with sensitive values redacted.
- [x] 2.5 Add an explicit feature-owned adapter selector/injection point that permits mock mode only in development/tests, defaults production to real transport, and never chooses mock based on URL input or real-request failure.
- [x] 2.6 Add a placeholder/final real-adapter boundary that reports normalized unavailable feedback while backend/generated contracts are incomplete and can later accept DTO mapping without component changes.

## 3. Deterministic Mock-First Implementation

- [x] 3.1 Add an instance-scoped mock scenario factory with injectable clock and fixtures for a valid v2 definition, resolved defaults, actions, expiration, and optional/no branding.
- [x] 3.2 Implement mock access-request with deterministic OTP, unique Challenge Token issuance, server-style cooldown/expiry metadata, access delivery failure, and access rate-limit scenarios.
- [x] 3.3 Implement mock resend semantics that enforce cooldown, replace the current Challenge Token, and invalidate every older challenge for that form session.
- [x] 3.4 Implement mock submit validation for processed inputs/action, configured OTP, current unexpired Challenge Token, duplicate/terminal submission, invalid OTP, stale challenge, expired challenge, and concurrent completion.
- [x] 3.5 Implement mock upload-token/file behavior for v2 file and file-list inputs, including success and upload failure scenarios.
- [x] 3.6 Add deterministic tests for valid, expired, submitted, not-found, rate-limited, delivery-failure, invalid-OTP, stale-challenge, concurrent-completion, and upload scenarios without making network requests.
- [x] 3.7 Add configuration tests proving production cannot accept the mock OTP or silently fall back to mock data when the real adapter is unavailable.

## 4. V2 Route and Form Loading

- [x] 4.1 Add failing route tests proving `/form-v2/[token]` resolves the v2 token, does not invoke legacy hooks, and resets all route-owned state when the token changes.
- [x] 4.2 Create the `web/app/(humanInputLayout)/form-v2/[token]/` page and route-owned feature composition using the selected transport and shared presentation primitives.
- [x] 4.3 Implement v2 form loading with implicit retry/refocus/reconnect behavior disabled where it could trigger access side effects, plus explicit retry for recoverable definition failures.
- [x] 4.4 Render resolved content, defaults, ordered actions, expiration, optional branding, loading, and neutral no-branding states through the version-neutral presentation layer.
- [x] 4.5 Implement localized not-found, expired, already-submitted, form-rate-limit, unavailable, and unknown status treatments that prevent access/upload/submit in terminal states.
- [x] 4.6 Add stale request tests proving a late definition/access response for a previous route token cannot update the current v2 page.

## 5. Email OTP and Challenge Session

- [x] 5.1 Add reducer/state-machine tests for loading-form, requesting-OTP, access-error, awaiting-OTP, challenge-expired, submitting, proof-error, terminal, and success transitions.
- [x] 5.2 Implement a route-local session controller that starts access-request exactly once after a valid definition and never auto-sends for loading, failed, or terminal definitions.
- [x] 5.3 Add Strict Mode, rerender, input-change, focus, reconnect, and access-failure tests proving only one automatic Email OTP request occurs until the user explicitly retries/resends.
- [x] 5.4 Store Challenge Token only in local session state and derive absolute resend/expiry deadlines from one receipt timestamp and server-provided durations.
- [x] 5.5 Implement clock-derived cooldown/expiry display and tests proving background/focus pauses do not extend deadlines and challenge expiry never auto-sends another email.
- [x] 5.6 Implement manual retry after initial access failure and cooldown-gated resend that replaces proof, clears OTP/proof errors, and preserves an older unexpired challenge when resend fails transiently.
- [x] 5.7 Add token-change and success cleanup tests proving OTP/Challenge values are cleared and stale proof cannot cross route sessions.

## 6. OTP-Guarded Form Submission

- [x] 6.1 Add failing tests for action enablement across required-field validity, OTP shape, Challenge presence/expiry, access pending, submit pending, and terminal states.
- [x] 6.2 Add the accessible OTP input and resend treatment, using `autocomplete="one-time-code"` and finalized/mock shape validation without exposing the fixed mock OTP in production UI.
- [x] 6.3 Build one atomic submit payload containing processed `inputs`, selected `action`, `otp_code`, and current `challenge_token`, and add exact payload tests.
- [x] 6.4 Implement a submit pending lock across all action buttons and tests proving rapid clicks or different action clicks create exactly one request.
- [x] 6.5 Map invalid OTP to retry with preserved form/challenge, stale/expired challenge to preserved form plus new access requirement, and task-complete/expired responses to terminal states.
- [x] 6.6 Clear sensitive proof before displaying success and add tests for success UI, disabled further mutations, and no proof retention.
- [x] 6.7 Add security tests proving OTP and Challenge Token never enter URL/search params, logs, analytics calls, localStorage, sessionStorage, persisted query data, or raw error text.

## 7. Version-Aware File Upload

- [x] 7.1 Add failing route-classifier tests for `/form/<token>`, `/form-v2/<token>`, malformed form paths, and unrelated routes.
- [x] 7.2 Replace the uploader's legacy-only regex with the centralized version-aware classifier and pass an explicit legacy/v2/non-form upload strategy.
- [x] 7.3 Connect v2 file and file-list inputs to the mock/canonical v2 upload-token transport while retaining existing shared file-value processing.
- [x] 7.4 Add integration tests proving v2 uses the hyphenated/mock upload path, v1 keeps the underscore path, and unrelated uploads do not consume route `token` as a form token.

## 8. Localization, Integration, and Verification

- [x] 8.1 Add v2 form, OTP, sent/requesting, resend/cooldown, challenge expiry, success, terminal, and recoverable error strings to `web/i18n/en-US/share.json` and `web/i18n/zh-Hans/share.json` only.
- [x] 8.2 Add locale tests proving all new English and Simplified Chinese strings resolve from i18n with no hardcoded user-facing copy or English fallback in `zh-Hans`.
- [x] 8.3 Add a full mocked route test covering load definition, one automatic access request, OTP entry, form validation, action submit with Challenge Token, and success.
- [x] 8.4 Add mocked recovery-flow tests for initial access retry, cooldown resend, invalid OTP correction, challenge replacement/expiry, concurrent completion, route token change, and file upload.
- [x] 8.5 Run focused legacy/v2 form, shared presentation, mock transport, session state, file uploader, and locale Vitest suites and resolve failures.
- [x] 8.6 Run the repository frontend formatting, Oxlint/ESLint, and TypeScript checks through `pnpm check`, documenting only unrelated pre-existing failures.
- [x] 8.7 Audit the final diff to prove it contains only `web/` plus this OpenSpec change, changes only `en-US`/`zh-Hans` locales, preserves `/form`, and adds no backend, runtime, generated-client, mail, or node-editor changes.
- [x] 8.8 Record the real-adapter handoff checklist: finalized Challenge/OTP fields and errors, canonical definition/branding DTO, upload contract, generated/public client mapping, v2 mail link, and mock/real contract-parity verification.
