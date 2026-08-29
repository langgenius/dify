## RENAMED Requirements

- FROM: `Workspace console MUST expose human-input contact directory APIs`
- TO: `Workspace console MUST expose human-input Contact APIs`

## MODIFIED Requirements

### Requirement: Workspace console MUST expose human-input Contact APIs
系统 MUST 在 `/console/api/workspaces/current/human-input` 下提供 workspace Contact APIs，覆盖 owner/admin 使用的 Contact list / detail / batch read、EE 下的 Platform candidate / add、External Contact 的创建与编辑，以及统一的批量 remove API。列表接口省略 `group` 时 MUST 不按类型过滤；显式 group filter 只允许 `workspace / platform / external`，`all` MUST NOT 作为真实 group value。External Contact normalized Email MAY 与当前 Workspace 或 Platform Contact 重叠，但同一 workspace 内两个 External Contacts MUST NOT 共享同一 normalized Email。

系统 MUST 另外提供 workflow editor 使用的 `contact-options` list / batch read model。该 read model MUST 使用 edit permission，MUST NOT 复用 owner/admin Contact response DTO，并 MUST 只返回 `id / type / name / avatar_url / email`。`email` MAY be null when the current Contact has no available Email。`id` MUST remain the Contact identity used by recipient DSL；`email` supports option presentation and same-email validation。普通 member MUST NOT 通过该接口浏览 current Contacts。

#### Scenario: 省略 group 浏览全部 current Contacts
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts` without `group`
- **THEN** 系统 MUST 返回 `ContactRepository.list_contact` 在当前 tenant 中产生的 `WORKSPACE`、`PLATFORM` 与 `EXTERNAL` Contacts

#### Scenario: 按 group 浏览 current Contacts
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts?group=platform`
- **THEN** 系统 MUST 返回当前 tenant 中 `type=PLATFORM` 的 Contacts

#### Scenario: 按 ID 读取 current Contact
- **WHEN** a workspace admin calls `GET /console/api/workspaces/current/human-input/contacts/<contact_id>` and `ContactRepository.get_contacts_by_id` returns a Contact
- **THEN** 系统 MUST 返回该 Contact 的 current tenant projection

#### Scenario: 按 ID 读取 unavailable Contact
- **WHEN** `ContactRepository.get_contacts_by_id` returns `None` for the requested tenant and Contact ID
- **THEN** `GET /console/api/workspaces/current/human-input/contacts/<contact_id>` MUST return `404 Not Found`

#### Scenario: 历史对象不回查 current Contact API
- **WHEN** a historical workflow、task or audit record renders a removed or unavailable Contact
- **THEN** 系统 MUST 使用创建时冻结的 snapshot，MUST NOT 通过 current Contact list or detail API 回查历史展示数据

#### Scenario: Workflow editor 搜索静态 recipient candidate
- **WHEN** a workflow editor with edit permission calls `GET /console/api/workspaces/current/human-input/contact-options?keyword=<string>`
- **THEN** 系统 MUST 返回当前 tenant 中可选择 Contact 的分页结果，每个 item MUST 只包含 `id / type / name / avatar_url / email`，MUST NOT 返回 IM binding 或 management metadata

#### Scenario: Workflow editor 批量回显已保存 recipient
- **WHEN** a workflow editor calls `GET /console/api/workspaces/current/human-input/contact-options/batch?contact_ids=<contact_id>`
- **THEN** 系统 MUST 使用与 contact option search 相同的最小 projection，返回 `ContactRepository.get_contacts_by_ids` 产生的 available Contacts，并包含各 Contact 当前可用的 nullable `email`

#### Scenario: Workflow editor 比较 same-email Contact candidates
- **WHEN** contact-option search or batch query returns two Contacts with the same normalized Email
- **THEN** 系统 MUST include each Contact's `email` so the editor can compare their normalized values while continuing to persist recipients by `contact_id`

#### Scenario: Contact option 省略 unavailable Contact
- **WHEN** contact option search or batch input contains an unavailable、deleted or foreign-tenant Contact ID
- **THEN** 系统 MUST omit that Contact from the response and MUST NOT expose canonical identity or historical data through current Contact APIs

#### Scenario: 普通 member 不能浏览 Contact option
- **WHEN** a workspace member without edit permission calls either `contact-options` endpoint
- **THEN** 系统 MUST reject the request

#### Scenario: EE 搜索 Platform candidate
- **WHEN** an EE workspace admin calls `GET /console/api/workspaces/current/human-input/organization-candidates`
- **THEN** the EE application service MUST call `EnterpriseContactRepository.list_organization_candidates` and `count_organization_candidates`
- **AND** core `ContactRepository` MUST NOT perform that cross-tenant search

#### Scenario: EE 添加 Platform Contact
- **WHEN** an EE workspace admin selects one Organization candidate for `POST /console/api/workspaces/current/human-input/contacts/platform`
- **THEN** the EE application service MUST pass the returned Contact-ID-backed `CandidateId` unchanged to `EnterpriseContactRepository.create_platform_entry`

#### Scenario: CE / SaaS 调用 Platform candidate or add endpoint
- **WHEN** a CE or SaaS workspace admin calls `GET /console/api/workspaces/current/human-input/organization-candidates` or `POST /console/api/workspaces/current/human-input/contacts/platform`
- **THEN** 系统 MAY 保留这些 routes，但 MUST 允许在运行时返回 edition-not-supported 类错误

#### Scenario: 创建与 Account-backed Contact 同邮箱的 External Contact
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/external` with a valid Email already used by a current Workspace or Platform Contact
- **THEN** 系统 MUST 创建 External Contact 并返回创建后的 Contact payload

#### Scenario: 创建重复 External Contact
- **WHEN** a workspace admin calls the same create endpoint with a normalized Email already owned by another External Contact in the same workspace
- **THEN** the API MUST reject the request with a conflict outcome

#### Scenario: 更新 External Contact 到 Account-backed Contact 同邮箱
- **WHEN** a workspace admin calls `PATCH /console/api/workspaces/current/human-input/contacts/external/<contact_id>` and changes the normalized Email to one used by an Account-backed Contact
- **THEN** 系统 MUST 只更新 External Contact 的 editable profile fields，MUST NOT merge or replace either Contact identity

#### Scenario: 更新 External Contact 为另一 External Contact 的重复邮箱
- **WHEN** a workspace admin updates one External Contact to a normalized Email already used by another External Contact in the same workspace
- **THEN** the API MUST reject the update with a conflict outcome

#### Scenario: 批量 remove mixed Platform and External Contacts
- **WHEN** a workspace admin calls `POST /console/api/workspaces/current/human-input/contacts/remove` with both Platform and External Contact IDs
- **THEN** 系统 MUST allow one batch request，remove each Platform entry only in the current tenant，and delete each owning-tenant External Contact

#### Scenario: Remove Platform Contact 只影响当前 tenant
- **WHEN** a workspace admin removes one Platform Contact through the batch remove endpoint
- **THEN** 系统 MUST pass its Contact ID to `EnterpriseContactRepository.delete_platform_entry`，delete only the current tenant's Platform entry，and MUST NOT delete the Account-backed Contact identity or Account

#### Scenario: Workspace Contact 不走 contacts remove API
- **WHEN** a workspace admin includes a `WORKSPACE` Contact in the batch remove endpoint
- **THEN** 系统 MUST reject that item or the complete request and MUST require membership management to perform member removal
