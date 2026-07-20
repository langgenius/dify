## ADDED Requirements

### Requirement: Human Input v2 shall have an isolated public route

The frontend MUST expose Human Input v2 forms at `/form-v2/<form_token>`. The v2 route MUST use v2 orchestration and canonical `human-input` transport paths, while `/form/<form_token>` MUST retain its legacy UI, underscore endpoints, payload, and behavior.

#### Scenario: Open a v2 form link

- **WHEN** a user opens `/form-v2/token-v2`
- **THEN** the frontend MUST load the v2 route with `token-v2` and MUST NOT invoke the legacy form query or submit hook

#### Scenario: Open a legacy form link

- **WHEN** a user opens `/form/token-v1`
- **THEN** the frontend MUST preserve the existing legacy page, `/form/human_input/token-v1` request behavior, and non-OTP submit payload

#### Scenario: Route token changes

- **WHEN** the v2 route changes from one form token to another without a full browser restart
- **THEN** the frontend MUST reset all form, proof, timer, error, and submission state and MUST ignore or abort late work for the previous token

### Requirement: The v2 page shall load and render a resolved form definition

The v2 page MUST request the form definition through the selected v2 transport and render resolved form content, inputs, default values, actions, expiration, and optional branding using version-neutral presentation. It MUST not trigger access-request until a valid definition is available.

#### Scenario: Form definition loads successfully

- **WHEN** the v2 transport returns a valid form definition
- **THEN** the page MUST initialize fields from resolved defaults, render content and actions in declared order, display expiration, and proceed to Email access-request

#### Scenario: Optional branding is absent

- **WHEN** the v2 definition does not contain legacy site/custom-branding data
- **THEN** the page MUST render a functional neutral form without crashing or synthesizing a legacy transport envelope

#### Scenario: Form loading fails transiently

- **WHEN** form definition loading fails with a recoverable network or mock-unavailable error
- **THEN** the page MUST show a retryable localized state and MUST NOT request OTP or render enabled action buttons

### Requirement: Terminal form states shall prevent further interaction

Not-found, expired, already-submitted, and form-level rate-limit responses MUST map to localized status treatments. A terminal form state MUST replace the interactive form and MUST prevent access, upload, and submit operations.

#### Scenario: Form is expired

- **WHEN** form load reports `human_input_form_expired` or its finalized v2 equivalent
- **THEN** the page MUST display the expired status and MUST NOT request Email OTP

#### Scenario: Form was already submitted

- **WHEN** form load or submit reports that the task/form is already complete
- **THEN** the page MUST display the completed terminal state and MUST disable every further mutation

#### Scenario: Form is not found

- **WHEN** the v2 transport reports an invalid or unknown form token
- **THEN** the page MUST display the localized not-found state without exposing raw transport details

### Requirement: Form actions shall validate and submit processed field values

The v2 page MUST reuse version-neutral initialization, required-field validation, file-value processing, and action styling. It MUST provide the selected action and processed inputs to the Email Challenge session, and MUST prevent duplicate or invalid submissions.

#### Scenario: Required field is incomplete

- **WHEN** one required rendered input is invalid or missing
- **THEN** every completion action MUST remain disabled and no submit transport call MUST occur

#### Scenario: Valid action is selected

- **WHEN** all rendered fields and Email proof are valid and the user activates one action
- **THEN** the page MUST submit processed inputs under their output keys with exactly that action ID

#### Scenario: Submission is pending

- **WHEN** one submit operation is in progress
- **THEN** all action buttons MUST expose a pending/disabled state and repeated activation MUST NOT start another operation

#### Scenario: Submission succeeds

- **WHEN** the v2 transport accepts the form payload
- **THEN** the page MUST clear sensitive proof, stop interactive mutations, and display the localized success/status treatment

### Requirement: Human Input file upload shall be version-aware

The frontend MUST classify `/form/<token>` as legacy, `/form-v2/<token>` as v2, and unrelated paths as non-form. V2 file and file-list inputs MUST use the selected v2 upload-token transport; legacy inputs MUST keep their existing upload endpoint and behavior.

#### Scenario: Upload from v2 form

- **WHEN** a user uploads a valid file from `/form-v2/token-v2`
- **THEN** the uploader MUST request the v2 canonical/mock upload token for `token-v2` and MUST attach the resulting file value to the v2 form

#### Scenario: Upload from legacy form

- **WHEN** a user uploads from `/form/token-v1`
- **THEN** the uploader MUST continue using the legacy upload-token and file-upload flow without v2 proof fields

#### Scenario: Unrelated route uses ordinary upload behavior

- **WHEN** the file uploader renders on a path that is neither a legacy nor v2 Human Input form
- **THEN** it MUST NOT treat route parameters as a Human Input form token

### Requirement: Shared presentation shall not share version-specific transport state

Reusable form content, input, action, expiration, branding, and status components MUST accept explicit version-neutral props. They MUST NOT import a route module, select legacy/v2 endpoints, or read OTP/Challenge Token state.

#### Scenario: Shared component renders v1 and v2 data

- **WHEN** the same presentation primitive receives normalized legacy data and normalized v2 data in separate tests
- **THEN** it MUST render equivalent form UI without invoking either version's service hooks

#### Scenario: Legacy regression suite runs after extraction

- **WHEN** shared presentation is introduced
- **THEN** the existing `/form/<token>` load, submit, error, branding, expiration, and upload observable behavior MUST remain unchanged

### Requirement: V2 public form copy shall use only the requested locale additions

Every new v2 page, OTP, resend, status, and error string MUST come from the share i18n namespace. This change MUST add new keys only to English (`en-US`) and Simplified Chinese (`zh-Hans`) locale files and MUST NOT hardcode user-facing copy in components.

#### Scenario: English v2 form

- **WHEN** the active locale is `en-US`
- **THEN** all new v2 form and Email challenge strings MUST resolve from the English share locale

#### Scenario: Simplified Chinese v2 form

- **WHEN** the active locale is `zh-Hans`
- **THEN** all new v2 form and Email challenge strings MUST resolve from Simplified Chinese without fallback English

#### Scenario: Other locale files remain unchanged

- **WHEN** implementation is complete
- **THEN** no new Human Input v2 public-form keys MUST be generated or edited outside `en-US` and `zh-Hans`

### Requirement: The implementation shall remain frontend-only

The change MUST be limited to frontend code, frontend mocks/tests, and its OpenSpec artifacts. It MUST NOT implement backend routes, mail delivery, OTP verification, generated API files, workflow runtime, or Human Input node/editor behavior.

#### Scenario: Backend contract is still unavailable

- **WHEN** the v2 backend stubs are not ready during frontend development
- **THEN** the page MUST remain implementable and testable through the explicit mock transport without modifying backend code
