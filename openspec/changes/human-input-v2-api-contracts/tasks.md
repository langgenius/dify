## 1. Define Shared DTOs And Contract Boundaries

- [ ] 1.1 Add shared Pydantic request and response models for the owner/admin contact directory, the editor-safe contact option list/batch projection, `workspace contact` / `Platform contact` / `External contact` entities, IM integration, latest-only IM sync detail, IM identity candidates, public runtime OTP submit, authenticated Contact session submit, and trusted Service API submit without OTP fields.
- [ ] 1.2 Reuse existing enums where semantics already match, including `DebugChannel`, `FormInputConfig`, `UserActionConfig`, and `HumanInputFormStatus`, instead of adding duplicate transport enums.
- [ ] 1.3 Add Pydantic batch request / response models and a stable node-scoped blocker taxonomy for the side-effect-free Human Input v1 → v2 node-data migration helper; default a missing legacy `version` to the string `"1"` and reject every other explicit version.
- [ ] 1.4 Document the ownership split so the backend helper stays an all-or-error batch converter / validator and does not take over user confirmation, node-set selection, atomic graph replacement, or draft persistence; explicitly record `whole_workspace: true` as the only sanctioned lossy snapshot conversion.

## 2. Implement Workspace Console APIs

- [ ] 2.1 Keep full Contact list/detail owner/admin-only, add edit-permission `contact-options` list/batch APIs with the minimal `id / type / name / avatar_url` projection, preserve paging and keyword search, and resolve `ABSENT` as omitted/404 according to the API surface.
- [ ] 2.2 Add EE-only `Platform contact` candidate and add APIs, and allow CE / SaaS implementations to reject candidate / add calls at runtime with an edition-not-supported error.
- [ ] 2.3 Add External contact create / update APIs plus one merged batch remove API for `Platform contact` and `External contact`, while keeping `workspace contact` removal in membership management.
- [ ] 2.4 Add Organization-level IM integration get, upsert, delete, and test APIs under `/console/api/workspaces/current/human-input/im-integration`; expose `integration_id + config_version` and require them for CAS update/delete of an existing integration.
- [ ] 2.5 Add manual IM sync create, latest summary, latest paginated results, provider-user-ID identity search, and contact IM override APIs; keep the UI latest-only, use `finished_at` as its sync time, omit `started_by`, require one real result bucket without an `All` mode, use `page / limit / total` rather than cursor pagination, omit summary from results pages, capture `integration_config_version`, and reject stale reconciliation writes.
- [ ] 2.6 Keep the v1 draft `delivery-test` contract unchanged, add an independent v2 `message-template/test` using `DebugChannel`, and make preview/run dispatch by node version without cross-submitting payloads.
- [ ] 2.7 Add `POST /console/api/workspaces/current/human-input/node-data-migration` as a tenant-scoped, deterministic, side-effect-free batch conversion endpoint that returns success only when every submitted node generates complete v2 node data and never persists workflow state or mutates graph/draft state.
- [ ] 2.8 Add focused tests for successful ordered batch conversion, one-node failure causing a whole-request error with no partial v2 node data, multiple node-scoped blockers, the sanctioned `whole_workspace: true` snapshot conversion, request-scoped tenant isolation, repeated-request idempotency, and the absence of workflow, graph, draft, or migration-state writes.

## 3. Implement Runtime Form APIs

- [ ] 3.1 Keep existing underscored v1 public and Service API routes unchanged, add independent hyphenated v2 routes, and reject cross-version form tokens in both directions.
- [ ] 3.2 Keep the public Email page and authenticated Contact page on separate frontend/backend surfaces; submit Email approvals through `/api/form/human-input/<form_token>` with OTP proof and Contact approvals through `/console/api/form/human-input/<form_token>` with Dify session proof; use independent controllers, request DTOs, and auth guards, and reject cross-surface tokens, grants, and proof fields in both directions.
- [ ] 3.3 Update the Service API form GET contract to require explicit query `user`, keep POST bound to explicit JSON `user`, and reject public-web OTP fields on the trusted Service API DTO.
- [ ] 3.4 Extend controller and service tests to cover version-isolated routes and DTOs, token-based form read, OTP challenge metadata, OTP-guarded web submit, session-guarded console submit, stale-OTP rejection after identity changes, cross-surface proof rejection, and cross-version token rejection.

## 4. Implement EE Admin Control-Plane

- [ ] 4.1 Add enterprise protobuf messages and RPCs for Organization-level IM integration get, upsert, delete, and test, using `integration_id + config_version` for CAS update/delete.
- [ ] 4.2 Add enterprise protobuf messages and RPCs for IM sync create, latest summary, and latest paginated results; expose `finished_at` without `started_by`, require one real bucket without an `All` mode, use `page / limit / total` without cursor or repeated summary, and include the captured integration ID and config revision used to reject stale writes.
- [ ] 4.3 Add enterprise protobuf messages and RPCs for Organization Contact list, synced IM identity search, binding create/delete, and binding-level reachability test.
- [ ] 4.4 Wire the EE deployment path so workspace console APIs call the enterprise control-plane where the source of truth lives outside CE runtime state.
- [ ] 4.5 Keep the EE proto surface narrow by excluding member/workspace CRUD, Platform/External Contact lifecycle, workspace override, migration, and Email provider APIs.

## 5. Verify And Document The Contracts

- [ ] 5.1 Update generated API docs or manual docs so v2 examples use `human-input` paths and `form` nouns while v1 examples retain the existing `human_input` paths.
- [ ] 5.2 Verify the root summary document and OpenSpec text both keep the migration ownership split explicit and aligned with the frontend migration change.
- [ ] 5.3 Verify the root summary document stays aligned with the landed Flask View and protobuf contracts.
- [ ] 5.4 Run `/opsx:apply` only after the Flask View, runtime auth, and enterprise proto contracts are all implemented and reviewed together.
