## ADDED Requirements

### Requirement: Contact approvers shall use an isolated authenticated v2 page

The frontend MUST expose workspace and Platform Contact approval at `/form-v2/contact/<form_token>`. The page MUST call only the authenticated v2 console surface under `/console/api/form/human-input/...` and MUST treat the route token as opaque. It MUST NOT call the public Email API, request an OTP, create a Challenge Token, inspect Contact/email data, or infer authentication from browser state.

#### Scenario: Workspace or Platform Contact opens a valid link

- **WHEN** a signed-in Dify Account opens `/form-v2/contact/contact-token` and the console API accepts the Contact-backed delivery
- **THEN** the frontend MUST load the authenticated Contact page and MUST NOT invoke public form or `access-request` operations

#### Scenario: Public Email token is opened on the Contact page

- **WHEN** the console API rejects a token owned by the public Email-proof surface
- **THEN** the frontend MUST show the normalized rejection and MUST NOT redirect to `/form-v2/<form_token>` or invoke Email OTP behavior

#### Scenario: Contact page receives no identity hints

- **WHEN** the Contact page receives only the opaque route token
- **THEN** it MUST pass that token to the console client without decoding identity, matching email, querying Contact type, or adding `auth_type` to the URL

### Requirement: The authenticated page shall load and render the resolved form

The frontend MUST obtain the definition through the generated v2 console query and map it into the version-neutral Human Input form domain. It MUST render resolved content, defaults, ordered actions, expiration, and optional branding with shared presentation while keeping authenticated orchestration separate from the public Email session.

#### Scenario: Definition loads successfully

- **WHEN** the generated console query returns a valid resolved definition
- **THEN** the page MUST initialize field defaults, render content and actions in declared order, and enable form interaction without starting an access request

#### Scenario: Definition is loading

- **WHEN** the current token's console definition request is pending
- **THEN** the page MUST show the standard loading treatment and MUST NOT permit upload or submit

#### Scenario: Route token changes during load

- **WHEN** navigation replaces the Contact token while a definition request is pending
- **THEN** the page MUST reset route-owned state and MUST ignore or abort the previous token's response

### Requirement: Contact submission shall rely only on Dify Account session proof

The authenticated page MUST validate and process form values through the shared form domain and MUST submit exactly `{ inputs, action }` through the generated v2 console mutation. It MUST NOT send `otp_code`, `challenge_token`, recipient identity, Contact type, email, or browser-derived account data. The server remains authoritative for the Account-to-Contact grant decision.

#### Scenario: Valid Contact submission

- **WHEN** required fields are valid and the approver selects an action
- **THEN** the frontend MUST send one console request containing processed `inputs` and the selected `action`

#### Scenario: Invalid form values

- **WHEN** one or more required fields are invalid
- **THEN** completion actions MUST remain disabled and no submit request MUST occur

#### Scenario: Multiple actions are activated while submit is pending

- **WHEN** the user activates the same or different actions while a Contact submission is pending
- **THEN** the frontend MUST send exactly one request and keep all completion actions disabled until it settles

#### Scenario: Contact submission succeeds

- **WHEN** the console mutation accepts the form
- **THEN** the frontend MUST clear mutable form state, display the shared success treatment, and prevent further upload or submit operations

### Requirement: Authenticated form failures shall remain on the Contact surface

The frontend MUST normalize not-found, forbidden or wrong-account, expired, already-submitted, rate-limited, upload-failed, network/unavailable, and unknown responses into localized states. Terminal states MUST prevent further mutations. Recoverable states MAY retain entered form values, but no failure MUST cause a request to the public Email surface or a silent runtime fallback.

#### Scenario: Signed-in account does not own the Contact grant

- **WHEN** the console API rejects the current Dify Account as unauthorized for the Contact-backed grant
- **THEN** the page MUST show localized wrong-account or access-denied guidance and MUST NOT submit with another proof method

#### Scenario: Form is expired or already submitted

- **WHEN** the console API reports an expired or completed form
- **THEN** the page MUST show the corresponding terminal status and disable upload and submit

#### Scenario: Recoverable network failure occurs

- **WHEN** definition loading fails with a recoverable network or unavailable response
- **THEN** the page MUST expose an explicit retry that repeats only the authenticated console request and preserves surface isolation

### Requirement: Contact-page file upload shall use authenticated console transport

File and file-list inputs on `/form-v2/contact/<form_token>` MUST request upload authorization through the generated v2 console upload-token operation and MUST use the Contact page's authenticated upload strategy. They MUST NOT send the token to the public v2 or legacy upload transport.

#### Scenario: Local file is uploaded from the Contact page

- **WHEN** a valid local file is selected on `/form-v2/contact/contact-token`
- **THEN** the uploader MUST obtain authorization through the Contact console transport and associate the resulting file value with the current form

#### Scenario: Remote file is added from the Contact page

- **WHEN** a valid remote URL is submitted for a Contact-page file input
- **THEN** the uploader MUST use the authenticated Contact upload strategy and MUST NOT invoke the public v2 transport

#### Scenario: Upload response belongs to an old token

- **WHEN** an upload response for a previous Contact token arrives after route navigation
- **THEN** the frontend MUST discard it and MUST NOT add the file to the current form

### Requirement: Authenticated Contact integration shall use generated console contracts only

The frontend MUST consume generated `consoleQuery` / `consoleClient` operations for the hyphenated v2 console GET, upload-token, and submit endpoints. It MUST NOT add handwritten REST helpers, local transport DTO mirrors, direct edits to generated files, runtime mock data, or reuse of the legacy underscore console endpoints. Tests MAY mock the generated client boundary without making network requests.

#### Scenario: Generated v2 console operation is unavailable

- **WHEN** the required generated console operation does not exist
- **THEN** implementation of that integration MUST remain pending rather than calling a handwritten, public, legacy, or mock runtime fallback

#### Scenario: Generated client is available in a test

- **WHEN** a focused frontend test supplies generated-client responses at the network boundary
- **THEN** the real feature mapping, state transitions, and rendered behavior MUST be exercised without production mock selection

### Requirement: Authenticated Contact copy shall be localized in the scoped locales

All new Contact approval, wrong-account, sign-in-return, unavailable, and status copy MUST resolve from the share namespace. This change MUST add or modify strings only in `en-US` and `zh-Hans`.

#### Scenario: English and Simplified Chinese render authenticated states

- **WHEN** each new Contact page state is rendered under `en-US` and `zh-Hans`
- **THEN** the UI MUST resolve localized copy without hardcoded user-facing text or English fallback in `zh-Hans`

### Requirement: The authenticated Contact change shall remain frontend-only

Implementation MUST be limited to `web/` and this OpenSpec change. It MUST NOT modify backend controllers, OpenAPI schemas, generated contracts, delivery records, message generation, workflow runtime, or mail/IM sending.

#### Scenario: Final change scope is audited

- **WHEN** the implementation diff is reviewed
- **THEN** it MUST contain no changes under `api/` or `packages/contracts/generated/` and MUST leave backend link generation to its owning change
