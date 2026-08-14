## ADDED Requirements

### Requirement: Workspace console External Contact APIs MUST allow internal-email overlap and preserve workspace-local external uniqueness
The workspace console Human Input Contact APIs MUST allow creating or updating an `External contact` whose normalized email overlaps with a `workspace contact` or `Platform contact`. The same APIs MUST continue rejecting duplicate normalized emails among `External contact` records in the same workspace. Overlap with an internal Contact MUST NOT trigger automatic promotion, merge, downgrade, or validation failure.

#### Scenario: Create External Contact with internal-contact email
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/external` with a valid email already used by a current `workspace contact` or `Platform contact`
- **THEN** the API MUST create the `External contact` successfully and MUST return it as a separate Contact

#### Scenario: Create duplicate External Contact in the same workspace
- **WHEN** a workspace admin calls the same create endpoint with a normalized email already owned by another `External contact` in the same workspace
- **THEN** the API MUST reject the request with a conflict outcome

#### Scenario: Update External Contact to overlap an internal Contact
- **WHEN** a workspace admin calls `PATCH /console/api/workspaces/current/human-input/contacts/external/<contact_id>` and changes the normalized email to one currently used by an internal Contact
- **THEN** the API MUST allow the update and MUST preserve the Contact as `External`

#### Scenario: Update External Contact to duplicate another External Contact
- **WHEN** a workspace admin updates one `External contact` to a normalized email already used by another `External contact` in the same workspace
- **THEN** the API MUST reject the update with a conflict outcome

### Requirement: Migration helper MUST preserve corrected email-recipient semantics
`POST /console/api/workspaces/current/human-input/node-data-migration` MUST apply the corrected PRD mapping rules. Legacy email recipients for current workspace members, Platform members, and other email targets MUST become `onetime_email` recipients unless another explicit corrected rule applies. The helper MUST NOT auto-upgrade legacy email recipients into Contact recipients and MUST NOT auto-create `External contact` records.

#### Scenario: Legacy workspace member email migrates to one-time email
- **WHEN** one submitted legacy node references a current workspace member email recipient
- **THEN** the helper MUST return `onetime_email` recipient data for that target rather than a Contact recipient

#### Scenario: Legacy Platform member email migrates to one-time email
- **WHEN** one submitted legacy node references another workspace or Platform member by email
- **THEN** the helper MUST return `onetime_email` recipient data and MUST NOT auto-add a `Platform contact`

#### Scenario: Legacy arbitrary email migrates to one-time email
- **WHEN** one submitted legacy node contains another valid email recipient
- **THEN** the helper MUST return `onetime_email` recipient data and MUST NOT auto-create an `External contact`

#### Scenario: Legacy email matches an existing Contact
- **WHEN** a submitted legacy email recipient shares a normalized email with any current Contact
- **THEN** the helper MUST still preserve it as email-scoped migration output unless another explicit migration rule rewrites that exact source type

### Requirement: Migration helper MUST represent legacy whole-workspace intent with `all_workspace_contacts`
When one submitted legacy node has enabled email configuration with `whole_workspace: true`, the helper MUST emit an explicit `all_workspace_contacts` recipient representation instead of expanding the legacy intent into a lossy static list. That representation MUST preserve migration intent and allow imported overlap with separately preserved recipients.

#### Scenario: Whole-workspace legacy recipient is migrated
- **WHEN** any submitted legacy node has enabled email configuration with `whole_workspace: true`
- **THEN** the helper MUST emit exactly one `all_workspace_contacts` recipient representation for that legacy source

#### Scenario: Whole-workspace overlaps a specific workspace Contact
- **WHEN** migrated output contains `all_workspace_contacts` and also preserves a specific workspace Contact that would already be covered by that set
- **THEN** the helper MUST preserve both recipients in imported output and MUST NOT collapse them during migration

#### Scenario: Whole-workspace overlaps a same-email External Contact
- **WHEN** migrated output contains `all_workspace_contacts` and also preserves an `External contact` whose normalized email matches a workspace member email
- **THEN** the helper MUST preserve both recipients in imported output and MUST NOT reject the batch solely because of that overlap

### Requirement: Workspace override APIs MUST allow scoped IM identity reuse
Workspace-scoped IM override APIs under `/console/api/workspaces/current/human-input` MUST allow one synced IM identity to be reused where the corrected EE rules permit it. The API MUST reject only real scope or availability violations and MUST NOT treat identity reuse by itself as a uniqueness conflict.

#### Scenario: Override reuses organization-bound identity in the same workspace
- **WHEN** a workspace admin sets one workspace override to an IM identity already used by another organization binding
- **THEN** the API MUST allow the override if current workspace rules permit it and MUST preserve organization binding state

#### Scenario: Override reuses one IM identity in another workspace
- **WHEN** another workspace already uses the same IM identity in its own override
- **THEN** the current workspace override request MUST still be allowed if all current-scope predicates pass

#### Scenario: Authorization or runtime lookup needs the Contact target
- **WHEN** a later task or runtime lookup evaluates an IM identity returned by override APIs
- **THEN** the contract MUST require workspace-scoped target context and MUST NOT imply a global `im_user_id -> Contact` reverse lookup
