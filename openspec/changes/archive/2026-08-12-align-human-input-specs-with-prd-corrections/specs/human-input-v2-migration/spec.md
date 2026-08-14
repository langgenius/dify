## ADDED Requirements

### Requirement: Legacy email recipients MUST migrate to one-time email semantics
The v1-to-v2 migration flow MUST convert legacy email recipients into `onetime_email` semantics unless one corrected migration rule explicitly says otherwise. Migration MUST NOT auto-upgrade these legacy email recipients into Contact recipients and MUST NOT auto-create `External contact` records.

#### Scenario: Current workspace member email migrates
- **WHEN** one legacy email recipient targets the current workspace member email path
- **THEN** migration MUST emit `onetime_email` recipient data for that target

#### Scenario: Other workspace or Platform member email migrates
- **WHEN** one legacy email recipient targets another workspace or Platform member email
- **THEN** migration MUST emit `onetime_email` recipient data and MUST NOT auto-add a `Platform contact`

#### Scenario: Arbitrary email recipient migrates
- **WHEN** one legacy email recipient targets another valid email address
- **THEN** migration MUST emit `onetime_email` recipient data and MUST NOT auto-create an `External contact`

#### Scenario: Legacy email matches a current Contact
- **WHEN** one legacy email recipient shares a normalized email with a current Contact
- **THEN** migration MUST still preserve email-scoped output rather than upgrading that recipient into a Contact recipient

### Requirement: Legacy `whole_workspace` MUST migrate to explicit `all_workspace_contacts`
The migration flow MUST represent legacy `whole_workspace: true` with one explicit `all_workspace_contacts` recipient instead of expanding it into a lossy static list. This requirement exists to preserve v1 intent losslessly through the v2 DSL.

#### Scenario: Legacy whole-workspace is present
- **WHEN** one legacy node enables `whole_workspace: true`
- **THEN** migration MUST emit one `all_workspace_contacts` recipient representation

#### Scenario: Whole-workspace is combined with initiator
- **WHEN** one legacy node contains both enabled WebApp and enabled whole-workspace email delivery
- **THEN** migration MUST preserve both the initiator recipient and one `all_workspace_contacts` recipient

#### Scenario: Whole-workspace is the only recipient path
- **WHEN** one legacy node relies only on `whole_workspace: true`
- **THEN** migration MUST still succeed without expanding the set into per-member static recipients

### Requirement: Migrated duplicate overlaps MUST be preserved as compatibility data
Migrated output MAY contain recipient combinations that overlap according to current manual authoring rules. The migration flow MUST preserve those overlaps when they are the unavoidable result of lossless migration and MUST NOT fail or normalize the node solely because of them.

#### Scenario: `all_workspace_contacts` overlaps an explicit workspace Contact
- **WHEN** one migrated node preserves both `all_workspace_contacts` and one explicit workspace Contact that the set already includes
- **THEN** migration MUST keep both recipients in the output

#### Scenario: `all_workspace_contacts` overlaps a same-email External Contact
- **WHEN** one migrated node preserves `all_workspace_contacts` together with one `External contact` whose normalized email matches a workspace member
- **THEN** migration MUST keep both recipients in the output

#### Scenario: Preserved overlap is imported into the editor
- **WHEN** migrated output containing one preserved overlap is later re-opened in the workflow editor
- **THEN** the migration contract MUST expect that overlap to remain round-trippable rather than being treated as malformed migration output
