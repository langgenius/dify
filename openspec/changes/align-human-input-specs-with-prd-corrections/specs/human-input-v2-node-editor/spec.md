## ADDED Requirements

### Requirement: Human Input v2 recipient schema MUST preserve migration-only `all_workspace_contacts`
The v2 node editor MUST recognize and round-trip an explicit `all_workspace_contacts` recipient representation used for migrated legacy data. The editor MUST preserve this recipient type in imported DSL, but manual authoring UI MUST NOT create it unless a future capability explicitly enables first-class authoring support.

#### Scenario: Imported migrated node contains `all_workspace_contacts`
- **WHEN** the editor loads one v2 node whose `recipients_spec` contains `all_workspace_contacts`
- **THEN** the editor MUST preserve, render, and re-serialize that recipient without dropping or rewriting it

#### Scenario: User manually adds recipients in a new v2 node
- **WHEN** a user creates or edits one ordinary v2 node through current authoring controls
- **THEN** the editor MUST NOT expose `all_workspace_contacts` as a manual add option

#### Scenario: Copy and paste preserves migration-only recipient
- **WHEN** a user copies and pastes one imported v2 node containing `all_workspace_contacts`
- **THEN** the pasted node MUST preserve that recipient type unchanged

### Requirement: Active manual selection MUST block same-email multiple Contact recipients
The node editor MUST prevent one HITL node from actively selecting multiple Contact recipients whose normalized emails are equal, even when they are different Contact identities such as `workspace contact`, `Platform contact`, or `External contact`. This rule applies to active manual selection and manual editing, not to migration-preserved imported compatibility data.

#### Scenario: Workspace Contact and External Contact share one email
- **WHEN** one node already contains one Contact recipient and a user tries to add another Contact recipient whose normalized email is the same
- **THEN** the editor MUST block the addition and MUST explain that only one same-email Contact may be actively selected

#### Scenario: Platform Contact and Workspace Contact share one email
- **WHEN** a user tries to add one `Platform contact` whose normalized email matches an already selected internal Contact
- **THEN** the editor MUST reject that selection even if the Contact IDs differ

#### Scenario: User edits one Contact into a conflicting email state
- **WHEN** editing one existing Contact selection would make two active Contact recipients share one normalized email
- **THEN** the editor MUST reject the edit or keep the node in an explicit uncommitted error state rather than silently saving it

### Requirement: Imported migration-preserved overlaps MUST remain round-trippable
Imported migrated DSL MAY contain recipient combinations that current manual authoring would not newly permit, including `all_workspace_contacts` overlapping a specific Contact or a same-email `External contact`. The editor MUST preserve those combinations as compatibility state and MUST NOT silently delete, merge, or normalize them away.

#### Scenario: `all_workspace_contacts` overlaps one explicit workspace Contact
- **WHEN** imported migrated data contains both `all_workspace_contacts` and one explicit workspace Contact already covered by that set
- **THEN** the editor MUST preserve both recipients through load, render, validate, and save

#### Scenario: `all_workspace_contacts` overlaps one same-email External Contact
- **WHEN** imported migrated data contains `all_workspace_contacts` and one `External contact` whose normalized email matches one workspace member email
- **THEN** the editor MUST preserve both recipients and MUST NOT drop either one as a duplicate

#### Scenario: User touches unrelated fields on a compatibility node
- **WHEN** a user edits timeout, message template, or another unrelated field on a node that already contains preserved migration overlaps
- **THEN** the editor MUST keep the preserved recipient structure unchanged

### Requirement: Contact-derived UI labels MUST use `Platform Contact` terminology
Any node-editor recipient summary, picker grouping, or imported recipient label that refers to a non-member internal Contact in the current workspace context MUST use `Platform Contact` terminology when describing the Contact type. The editor MUST NOT present `Organization` as the user-facing Contact type label for that case.

#### Scenario: Picker shows internal non-member Contact
- **WHEN** one contact option resolves as a current-workspace `Platform contact`
- **THEN** the picker and summary UI MUST label it as `Platform Contact`

#### Scenario: Imported recipient summary renders a Platform Contact
- **WHEN** one imported `contact_id` resolves to a `Platform contact`
- **THEN** the summary UI MUST not replace the type label with `Organization`

#### Scenario: Ownership-boundary language remains separate
- **WHEN** the editor explains search scope or ownership boundaries
- **THEN** it MAY still use `Organization` for scope concepts, but MUST keep that separate from the Contact type label
