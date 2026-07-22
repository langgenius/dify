## 1. Define Shared DTOs And Contract Boundaries

- [ ] 1.1 Add shared Pydantic request and response models for contact directory, `workspace contact` / `Platform contact` / `External contact` entities, IM integration, IM sync detail, IM identity candidates, and runtime OTP submit.
- [ ] 1.2 Reuse existing enums where semantics already match, including `DebugChannel`, `FormInputConfig`, `UserActionConfig`, and `HumanInputFormStatus`, instead of adding duplicate transport enums.
- [ ] 1.3 Add Pydantic batch request / response models and a stable node-scoped blocker taxonomy for the side-effect-free Human Input v1 → v2 node-data migration helper.
- [ ] 1.4 Document the ownership split so the backend helper stays an all-or-error batch converter / validator and does not take over user confirmation, node-set selection, atomic graph replacement, or draft persistence; explicitly record `whole_workspace: true` as the only sanctioned lossy snapshot conversion.

## 2. Implement Workspace Console APIs

- [ ] 2.1 Add `/console/api/workspaces/current/human-input/contacts` list APIs with paging, keyword search, and `all / workspace / platform / external` group filtering.
- [ ] 2.2 Add EE-only `Platform contact` candidate and add APIs, and allow CE / SaaS implementations to reject candidate / add calls at runtime with an edition-not-supported error.
- [ ] 2.3 Add External contact create / update APIs plus one merged batch remove API for `Platform contact` and `External contact`, while keeping `workspace contact` removal in membership management.
- [ ] 2.4 Add Organization-level IM integration get, upsert, and test APIs under `/console/api/workspaces/current/human-input/im-integration`.
- [ ] 2.5 Add IM sync run create, list, and detail APIs plus IM identity candidate search and contact IM override APIs.
- [ ] 2.6 Replace the v1 draft `delivery-test` contract with `message-template/test`, using `DebugChannel` instead of `delivery_method_id`.
- [ ] 2.7 Add `POST /console/api/workspaces/current/human-input/node-data-migration` as a tenant-scoped, deterministic, side-effect-free batch conversion endpoint that returns success only when every submitted node generates complete v2 node data and never persists workflow state or mutates graph/draft state.
- [ ] 2.8 Add focused tests for successful ordered batch conversion, one-node failure causing a whole-request error with no partial v2 node data, multiple node-scoped blockers, the sanctioned `whole_workspace: true` snapshot conversion, request-scoped tenant isolation, repeated-request idempotency, and the absence of workflow, graph, draft, or migration-state writes.

## 3. Implement Runtime Form APIs

- [ ] 3.1 Add or alias public, service, and console runtime routes so the canonical path segment is `human-input` while the resource noun remains `form`.
- [ ] 3.2 Add public web `access-request` API for OTP delivery, keep `upload-token` token-based, and move approver verification into `submit`.
- [ ] 3.3 Update the Service API form GET contract to require explicit query `user`, and keep POST bound to explicit JSON `user`.
- [ ] 3.4 Extend controller and service tests to cover token-based form read, OTP challenge, OTP-guarded submit, and stale-OTP rejection after identity changes.

## 4. Implement EE Admin Control-Plane

- [ ] 4.1 Add enterprise protobuf messages and RPCs for Organization-level IM integration get, upsert, delete, and test.
- [ ] 4.2 Add enterprise protobuf messages and RPCs for IM sync run create, list, and detail.
- [ ] 4.3 Wire the EE deployment path so workspace console APIs call the enterprise control-plane where the source of truth lives outside CE runtime state.
- [ ] 4.4 Keep the EE proto surface narrow by reusing existing enterprise member and workspace APIs instead of duplicating their CRUD semantics.

## 5. Verify And Document The Contracts

- [ ] 5.1 Update generated API docs or manual docs so the canonical examples use `human-input` paths and `form` nouns.
- [ ] 5.2 Verify the root summary document and OpenSpec text both keep the migration ownership split explicit and aligned with the frontend migration change.
- [ ] 5.3 Verify the root summary document stays aligned with the landed Flask View and protobuf contracts.
- [ ] 5.4 Run `/opsx:apply` only after the Flask View, runtime auth, and enterprise proto contracts are all implemented and reviewed together.
