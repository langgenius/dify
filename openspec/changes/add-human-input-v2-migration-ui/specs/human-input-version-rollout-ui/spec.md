## ADDED Requirements

### Requirement: Human Input creation shall expose only the v2-backed candidate

The block catalog MUST expose one user-facing candidate named Human Input, and selecting it MUST create persisted `type: human-input`, `version: '2'` data. The legacy Human Input default MUST remain available for rendering imported drafts but MUST NOT be exposed as a creation choice.

#### Scenario: New app exposes only v2 Human Input

- **WHEN** a newly created workflow has no legacy Human Input nodes
- **THEN** the selector MUST show one enabled Human Input candidate and adding it MUST create exact v2 data

#### Scenario: Existing v2-only workflow exposes only v2 Human Input

- **WHEN** an existing workflow contains no legacy Human Input nodes, including one that already contains v2 nodes
- **THEN** the selector MUST show one enabled Human Input candidate and MUST NOT show a legacy creation candidate or a separate user-facing `Human Input v2` duplicate

### Requirement: Any legacy node shall block every in-editor Human Input insertion path

While the current draft contains at least one legacy-rendered Human Input, the frontend MUST prevent inserting either generation of Human Input through selector click, keyboard/quick-add, duplicate, clipboard paste, or template/snippet insertion. The guard MUST be derived from current graph state and MUST lift only after no legacy Human Input remains.

#### Scenario: Legacy-only workflow cannot add Human Input

- **WHEN** a workflow contains one or more legacy Human Input nodes
- **THEN** all in-editor Human Input insertion paths MUST be rejected without changing graph state

#### Scenario: Mixed workflow remains blocked

- **WHEN** a workflow contains both legacy and exact v2 Human Input nodes
- **THEN** adding another Human Input MUST remain blocked until every legacy node is migrated or removed

#### Scenario: Migration immediately lifts the block

- **WHEN** migration succeeds and current graph state contains no legacy Human Input
- **THEN** the centralized creation policy MUST enable the v2-backed Human Input candidate without reloading the editor

#### Scenario: Restoring an existing legacy DSL remains possible

- **WHEN** the editor loads a complete saved workflow that already contains legacy Human Input nodes
- **THEN** it MUST render those nodes and apply migration guidance rather than reject the workflow as an insertion attempt

### Requirement: Legacy workflows shall show the Figma migration banner

When the draft contains a legacy Human Input, the workflow MUST render the banner from Figma node `1333:5041` with a migration explanation, Learn more action, and Migrate action. The banner MUST disappear when no legacy nodes remain and MUST not alter graph data by rendering.

#### Scenario: Legacy workflow displays guidance

- **WHEN** at least one legacy Human Input is present
- **THEN** the banner MUST explain that all old Human Input nodes must be migrated before new ones can be added and MUST expose Learn more and Migrate actions to an editor

#### Scenario: V2-only workflow omits guidance

- **WHEN** the graph contains no legacy Human Input nodes
- **THEN** the migration banner MUST not render

#### Scenario: Read-only user cannot mutate

- **WHEN** a user without workflow edit permission views a legacy workflow
- **THEN** the UI MUST communicate the old-version state but MUST not offer an active migration or insertion action

### Requirement: Legacy node and panel shall remain usable and visibly marked

Every legacy-rendered Human Input canvas node and its legacy configuration panel MUST display the `OLD VERSION` marker from Figma node `1333:5041`. Apart from migration presentation and insertion gating, existing legacy data and editing behavior MUST remain unchanged until successful migration.

#### Scenario: Legacy node is marked on canvas

- **WHEN** a legacy Human Input node is rendered
- **THEN** its title area MUST show `OLD VERSION` without changing node data, ports, or interactions

#### Scenario: Legacy panel is marked while retaining controls

- **WHEN** a user opens a legacy Human Input panel
- **THEN** the panel MUST show `OLD VERSION` and MUST retain the existing form, actions, timeout, and delivery-method controls

#### Scenario: Exact v2 has no legacy marker

- **WHEN** a Human Input node has exact string `version: '2'`
- **THEN** neither its node nor panel MUST show `OLD VERSION`

### Requirement: The blocked selector shall remain discoverable and provide migration entry

In a legacy-containing workflow, the single Human Input candidate MUST remain visible and searchable but disabled, match the `DISABLED` state in Figma node `1333:5414`, and present the migration explanation and `Migrate now` entry from Figma node `1333:5404`. Disabled candidate activation MUST never insert a node.

#### Scenario: Search finds disabled Human Input

- **WHEN** a user searches for Human Input while legacy nodes exist
- **THEN** the selector MUST return the candidate with a `DISABLED` badge and disabled visual/semantic state

#### Scenario: Disabled candidate cannot be activated

- **WHEN** the user clicks the candidate or invokes it from the keyboard
- **THEN** no node MUST be inserted and the candidate MUST expose its disabled reason accessibly

#### Scenario: Preview opens the shared migration dialog

- **WHEN** an editor activates `Migrate now` from the candidate preview
- **THEN** the selector MUST not add a node and MUST open the same migration confirmation used by the workflow banner

### Requirement: Migration confirmation shall match the supplied dialog behavior

The banner and selector migration entries MUST open one accessible confirmation dialog matching Figma node `1333:5522`. It MUST identify that all old nodes are updated together, state that existing configuration is preserved, remind the user to review migrated nodes before publishing, and offer Cancel and Migrate actions.

#### Scenario: Dialog opens from either entry point

- **WHEN** an editor selects Migrate in the banner or `Migrate now` in the preview
- **THEN** the same dialog MUST open with title `Migrate Human Input nodes?`, preservation copy, review guidance, Cancel, and Migrate

#### Scenario: Cancel preserves the workflow

- **WHEN** the user chooses Cancel, presses Escape, or otherwise dismisses before confirmation
- **THEN** the dialog MUST close, restore focus to its invoker, and leave all nodes, edges, history, and draft synchronization unchanged

#### Scenario: Pending confirmation prevents duplicate work

- **WHEN** the confirmed migration is awaiting backend conversion, mutating the graph, or synchronizing the draft
- **THEN** the dialog MUST expose a pending state, prevent dismissal that would orphan the operation, and prevent another confirmation

#### Scenario: Dialog is keyboard accessible

- **WHEN** the dialog is open
- **THEN** focus MUST remain inside it, actions MUST have accessible names, and keyboard users MUST be able to cancel or confirm under the same rules as pointer users

### Requirement: Completion and failure feedback shall track durable state

The UI MUST show the success toast from Figma node `1333:5532` only after the migrated draft is successfully synchronized. Success MUST close the dialog, remove legacy guidance, and enable v2 creation from derived graph state. Backend conversion, response-validation, or synchronization failure MUST retain or restore the legacy UI and show localized recoverable error feedback.

#### Scenario: Migration succeeds

- **WHEN** all legacy nodes migrate and draft synchronization succeeds
- **THEN** the UI MUST show `Human Input nodes migrated successfully`, close the dialog, remove the banner and legacy markers, and enable Human Input creation

#### Scenario: Backend conversion fails

- **WHEN** the backend rejects the migration batch or returns an invalid or incomplete success response
- **THEN** no success toast MUST appear, the dialog or linked error treatment MUST identify available affected nodes/reasons, and legacy guidance MUST remain

#### Scenario: Synchronization fails and rolls back

- **WHEN** the migration graph transaction is restored after draft synchronization failure
- **THEN** no success toast MUST appear, the old-version banner/markers and disabled candidate MUST be restored, and the user MUST receive a retryable localized error

### Requirement: New migration copy shall be localized only in the requested locales

Every new user-facing migration string, disabled reason, status, and error MUST be read from the workflow i18n namespace. This change MUST add or update migration keys in English (`en-US`) and Simplified Chinese (`zh-Hans`) only and MUST NOT generate equivalent keys for other locales.

#### Scenario: English workflow renders migration UI

- **WHEN** the active locale is English
- **THEN** every migration banner, marker, selector, dialog, toast, and error string MUST resolve from `en-US` without hardcoded UI copy

#### Scenario: Simplified Chinese workflow renders migration UI

- **WHEN** the active locale is Simplified Chinese
- **THEN** every migration banner, marker, selector, dialog, toast, and error string MUST resolve from `zh-Hans` without falling back to English

#### Scenario: Other locale files remain untouched

- **WHEN** implementation is complete
- **THEN** this change MUST NOT add or modify Human Input migration keys in locale directories other than `en-US` and `zh-Hans`
