## 1. Normalize DSL And Shared DTOs

- [ ] 1.1 Rename `HumanInputNodeData.recpients_spec` to `recipients_spec`.
- [ ] 1.2 Add shared Pydantic request and response models for contact directory, `workspace contact` / `Platform contact` / `External contact` entities, IM integration, IM sync detail, IM identity candidates, and runtime OTP submit.
- [ ] 1.3 Reuse existing enums where semantics already match, including `DebugChannel`, `FormInputConfig`, `UserActionConfig`, and `HumanInputFormStatus`, instead of adding duplicate transport enums.

## 2. Implement Workspace Console APIs

- [ ] 2.1 Add `/console/api/workspaces/current/human-input/contacts` list APIs with paging, keyword search, and `all / workspace / platform / external` group filtering.
- [ ] 2.2 Add EE-only `Platform contact` candidate and add APIs, and allow CE / SaaS implementations to reject candidate / add calls at runtime with an edition-not-supported error.
- [ ] 2.3 Add External contact create / update APIs plus one merged batch remove API for `Platform contact` and `External contact`, while keeping `workspace contact` removal in membership management.
- [ ] 2.4 Add Organization-level IM integration get, upsert, and test APIs under `/console/api/workspaces/current/human-input/im-integration`.
- [ ] 2.5 Add IM sync run create, list, and detail APIs plus IM identity candidate search and contact IM override APIs.
- [ ] 2.6 Replace the v1 draft `delivery-test` contract with `message-template/test`, using `DebugChannel` instead of `delivery_method_id`.

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
- [ ] 5.2 Verify the root summary document stays aligned with the landed Flask View and protobuf contracts.
- [ ] 5.3 Run `/opsx:apply` only after the Flask View, runtime auth, and enterprise proto contracts are all implemented and reviewed together.
