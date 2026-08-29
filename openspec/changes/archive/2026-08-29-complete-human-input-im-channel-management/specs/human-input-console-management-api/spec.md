## ADDED Requirements

### Requirement: Workspace console MUST expose latest-run IM sync, identity search, and override APIs

系统 MUST 在 `/console/api/workspaces/current/human-input` 下继续提供 manual sync、最近一次 sync run summary、按 result 分页的最近一次 sync results、IM identity candidate 查询和 workspace IM override APIs。该 surface MUST 是 latest-only，MUST NOT 新增 run-by-ID、run list 或 historical run detail endpoint。Manual sync results MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。Same IM identity reuse across Organization binding and workspace overrides MUST be modeled as a workspace-scoped resolution concern, not a global uniqueness conflict。

#### Scenario: Manual IM sync is requested

- **WHEN** workspace owner or admin calls `POST /console/api/workspaces/current/human-input/im-sync-runs`
- **THEN** system MUST atomically obtain the current single active run
- **AND** it MUST create a run with current `integration_id` and `config_version` when no active run exists, or reuse the active run when one exists

#### Scenario: Sync run references a stale Integration revision

- **WHEN** IM sync worker is ready to apply results but current Integration ID or config version no longer matches the revision captured by the run
- **THEN** system MUST terminate the run as stale work
- **AND** it MUST NOT write current IM identities, Organization bindings or workspace overrides

#### Scenario: Latest sync run summary is requested

- **WHEN** workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest`
- **THEN** system MUST return run metadata, `finished_at` and aggregate counts for all five result buckets
- **AND** it MUST NOT return `started_by`

#### Scenario: Latest sync results are requested by bucket

- **WHEN** workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest/results?result=not_matched&page=1&limit=20`
- **THEN** system MUST return only the latest run's `not_matched` results using `page / limit / total`
- **AND** it MUST NOT repeat run summary in the paginated response

#### Scenario: Latest sync result omits a real bucket

- **WHEN** caller omits `result` or requests `result=all`
- **THEN** API MUST reject the request
- **AND** `result` MUST be one of `added / not_matched / failed / removed / skipped`

#### Scenario: Sync result item is returned

- **WHEN** caller reads one latest-run result page
- **THEN** each `IMSyncResultItem` MUST describe its reconciliation result without returning `HumanInputContactType`

#### Scenario: Removed sync result is returned

- **WHEN** caller reads one `removed` result
- **THEN** system MUST return `not_present_in_directory`, `binding_invalidated` or `binding_replaced` as the machine-readable reason

#### Scenario: IM identity is searched by provider user ID

- **WHEN** workspace owner or admin searches `GET /console/api/workspaces/current/human-input/im-identities`
- **THEN** system MUST match provider-side user identifier in addition to display name and email

#### Scenario: Workspace IM override is set

- **WHEN** workspace admin calls `PUT /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override` with one synced identity
- **THEN** system MUST bind that identity as the current workspace override
- **AND** it MUST NOT rewrite the Organization-level global IM identity

#### Scenario: Override reuses an Organization-bound identity

- **WHEN** workspace admin selects an identity already used by another Organization binding
- **THEN** API MUST allow the override if current workspace predicates pass
- **AND** it MUST preserve Organization binding state

#### Scenario: Override reuses an identity from another workspace

- **WHEN** another workspace already uses the same identity in its override
- **THEN** current workspace request MUST remain allowed if all current-scope predicates pass

#### Scenario: Contact target is needed for authorization or runtime lookup

- **WHEN** later task or runtime lookup evaluates an identity returned by override APIs
- **THEN** contract MUST require workspace-scoped target context
- **AND** it MUST NOT imply a global `im_user_id -> Contact` reverse lookup

## REMOVED Requirements

### Requirement: Workspace console MUST expose IM integration, latest-run sync summary, paginated sync results, identity search, and override APIs

**Reason**: This requirement combines two lifecycle owners. IM configuration now belongs exclusively to the canonical Channel Console API, while sync, identity search and workspace override routes remain in this capability. Keeping `/im-integration` would create a second public configuration authority.

**Migration**: Replace configuration calls to `/console/api/workspaces/current/human-input/im-integration` and `/im-integration/test` with `/console/api/workspace/current/human-input/v2/channels/im`、its ID-addressed item and replacement routes、and `/channels/im/test`。Remove the two legacy route registrations so requests return route-level `404`。Move canonical Console provider credential DTO ownership to `api/controllers/console/human_input_v2/providers.py` and remove or migrate duplicate legacy controller DTOs。The remaining sync、identity and override behavior moves to the new requirement above without changing paths。
