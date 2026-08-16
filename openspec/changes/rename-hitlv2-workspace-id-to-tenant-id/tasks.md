## 1. Scope And Contract Characterization

- [ ] 1.1 Add failing persistence-model tests proving `EmailOTPAuthorizationProof` requires `.tenant_id`, serializes only `tenant_id`, and rejects `workspace_id` or a missing owner key.
- [ ] 1.2 Add failing notification serialization tests proving the current rendered Email schema uses only `tenant_id` and treats `workspace_id` as malformed input.
- [ ] 1.3 Inventory every HITLv2 `workspace_id` occurrence and classify it as Dify tenant owner, external workspace boundary, IM Provider namespace/adapter field, log field, or test fixture before applying replacements.

## 2. Domain Ownership Model

- [ ] 2.1 Replace `WorkspaceId` with `TenantId` in `core.human_input_v2.shared`, update public exports, and change `WorkspaceScope` to expose `id: TenantId` while retaining its class name and `kind = "workspace"`; document that `id` corresponds to Dify `Tenant.id`.
- [ ] 2.2 Rename tenant-owner fields and parameters across approval/form references, proof contracts, recipient resolution ports, and submission authorization domain code; update invariants and owner comparisons without adding compatibility aliases.
- [ ] 2.3 Rename tenant-owner fields and parameters across Contact Directory entities, policies, snapshots, scopes, and ports while preserving workspace-relative resolution semantics.
- [ ] 2.4 Rename tenant-owner fields and parameters across Email channel configuration, rendered delivery contracts, runtime ports, and channel-management context.
- [ ] 2.5 Rename only Dify owner fields and parameters across IM Integration, binding resolution, control-plane ports, and sync contracts; leave all other IM-scoped namespace, identifier, contract, and adapter fields unchanged.

## 3. Persistence And Serialization Adapters

- [ ] 3.1 Rename `EmailOTPAuthorizationProof.workspace_id` to `tenant_id` without a validation alias, and verify `FrozenPydanticModelColumn` serializes and validates only the canonical field.
- [ ] 3.2 Update approval, form, submission, and audit mappers/repositories to consume `TenantId` / `tenant_id`, map directly to existing ORM `tenant_id`, and retain complete owner checks.
- [ ] 3.3 Update Contact Directory and Email channel mappers/repositories to use tenant terminology while retaining all existing tenant predicates, locks, and conflict translation.
- [ ] 3.4 Update IM Integration mappers, repositories, protected unit of work, and binding operations to use tenant terminology only for Dify owner values, without changing IM Provider namespace mappings or IM Provider adapter contracts.
- [ ] 3.5 Change the current rendered Email request serializer and deserializer to use only `tenant_id` without adding a schema version or legacy reader, and reject missing or `workspace_id` owner shapes.

## 4. Application And Composition Boundaries

- [ ] 4.1 Update Human Input channel managers and composition code so existing workspace-facing inputs are converted once to `TenantId` and all downstream HITLv2 contracts use `tenant_id`.
- [ ] 4.2 Update form creation, notification production, submission, node-data migration, and workspace-member lookup collaborators to use tenant terminology internally while preserving external routes and product wording.
- [ ] 4.3 Update delivery producer, worker, runtime, encryption-key selection, and retry flows to use the single `tenant_id` rendered Email payload shape.
- [ ] 4.4 Update IM contact-sync composition, coordination, locking, worker arguments, and binding services to use `tenant_id` without legacy keyword aliases or compatibility parsing.
- [ ] 4.5 Rename HITLv2 tenant-owner log labels and diagnostic fields, document any observability query impact, and verify no provider tenant log labels were changed.

## 5. Tests And Verification

- [ ] 5.1 Update HITLv2 core, repository, service, controller, migration, and concurrency fixtures to construct `TenantId` / `tenant_id` models and `WorkspaceScope(id=...)`, and assert unchanged cross-tenant rejection behavior.
- [ ] 5.2 Add or retain targeted IM tests proving Dify `tenant_id`, shared IM Provider namespace `provider_tenant_id`, and IM Provider adapter-native `tenant_id` remain independent, and that non-owner IM-scoped contracts are unchanged.
- [ ] 5.3 Run the HITLv2 unit suites with `uv run --project api pytest` for `api/tests/unit_tests/core/human_input_v2`, `api/tests/unit_tests/repositories/human_input_v2`, and `api/tests/unit_tests/services/human_input_v2`, plus the affected channel-management/controller tests.
- [ ] 5.4 Run backend formatting/lint and type checking using the repository-prescribed `make lint` and `make type-check` commands.
- [ ] 5.5 Audit residual `WorkspaceId` / `workspace_id` occurrences in HITLv2-owned code, justify only explicit external or provider-boundary allowlist entries, and confirm the change adds no database migration, payload migration, or schema edit.
- [ ] 5.6 Leave Docker-backed integration and concurrency suites for CI, and record the relevant HITLv2 integration suites expected to validate unchanged transaction and isolation behavior.
