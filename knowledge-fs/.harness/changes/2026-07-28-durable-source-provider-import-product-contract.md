# Durable source provider import product contract

## What changed

- Added the stable `createSourceImportWorkflow` OpenAPI operation id to the existing durable provider-import route.
- Registered `source_workflows.import.create` in the TypeScript Capability v2 policy and regenerated the checked-in operation export.
- Added the matching Dify Python Capability v2 mirror and the `importSourceWorkflow` product operation.
- Added a typed Console BFF request model for the discriminated `online-document-import` and `online-drive-import`
  payloads, including the 200-item bound and the exact field limits enforced by the durable workflow runtime.
- Added the Console facade and `POST /knowledge-fs/spaces/{control_space_id}/sources/{source_id}/workflow-imports`
  controller route. The route requires an 8-255 character `Idempotency-Key` and returns the accepted source workflow
  with HTTP 202. The product request budget is 4 MiB, which admits a full 200-item schema-bounded Unicode payload.
- Made source-connection create, list, and refresh handlers accept an already-authorized, route-exact Capability v2
  grant for integrated spaces instead of consulting the intentionally absent legacy KFS-owned product ACL. The
  handler-level defense verifies action, namespace, subject, knowledge-space resource id/type, and null parent;
  non-Capability and unsupported source-connection routes keep using the legacy authorization guard.
- Made source-connection creation issue a Capability-backed transaction fence instead of a local permission snapshot
  for integrated requests. The repository locks the active grant with the exact create action and knowledge-space
  binding in both the provisioning and activation transactions, persists only the grant locator, and redacts it from
  public responses. Legacy connections continue to use the existing local durable permission snapshot.
- Preserved per-request Capability semantics for later mutations: a refresh grant is independently checked for its
  exact refresh action and resource binding, while the connection retains its original create-grant provenance.
  Capability-origin and legacy-origin connections cannot cross authorization channels, but a valid refresh grant is
  intentionally not required to equal the create grant.
- Added replay-safe PostgreSQL and TiDB migration `0031_source_connection_capability_provenance`, with a scoped
  Capability foreign key and tenant/space/grant audit index. Source-connection get/list remain bounded tenant/space
  reads and do not depend on a local ACL aggregate.
- Persisted non-secret provider coordinates and a hashed, immutable selection marker on the first online document or
  online drive import. Later imports and syncs fail closed if a provider identity changes coordinates, two identities
  alias one coordinate, or logical inventory escapes the frozen selection.
- Made online document and online drive sync selection-aware so it refreshes only explicitly imported resources.
  Online drive lookups share one run-level browse-page budget instead of resetting the budget per selected file.
- Made durable source sync policies authorization-source aware. Integrated requests now persist only the admitted
  Capability grant id, while legacy requests continue to persist the local permission snapshot, requester, channel,
  and frozen content scope. The TypeScript record and database check constraint make those alternatives mutually
  exclusive, and public GET/PUT responses continue to omit both provenance forms.
- Added migration `0032_capability_source_sync_policies` for PostgreSQL and TiDB. It adds the scoped Capability foreign
  key, nullable legacy columns, authorization/revision constraints, and a tenant/space/grant audit index.
- Fenced Capability-backed policy writes and scheduled runs against an active grant under the same transaction used
  for source admission. The fence requires the exact `source_sync_policies.update` action and exact source plus parent
  space resource binding; revoked, tombstoned, malformed, or differently-bound grants disable the due policy without
  enqueuing a run.
- Regenerated the Console KnowledgeFS TypeScript/Zod/oRPC client and added a contract smoke test.

## Why

The KnowledgeFS runtime already owned durable provider import execution, but the route lacked an operation id and was
therefore absent from Capability v2, the Dify product-operation allowlist, and the generated Console client. Online
document and online drive setup could enumerate provider items but could not submit the selected items through the
production `sourceProduct` boundary.

Integrated spaces deliberately persist no KFS member, access-policy, or API-access rows because Dify owns product
authorization after activation. Source-connection handlers were the remaining exception: even after Capability v2
middleware authorized the exact request, they consulted that removed local ACL and returned a false 403.

The source-connection service also unconditionally minted a local permission snapshot before creating a connection.
That made a handler-level authorization exception insufficient and left a revoke race between request admission and
the final state transition. The Capability fence now rechecks the durable grant under the connection mutation
transaction. It adds one indexed composite-key grant lookup per mutation, introduces no list/read query waterfall,
and stores no bearer, raw jti, Dify credential, or local membership reconstruction.

The same ownership boundary applies to source sync policies. Minting a local permission snapshot during an integrated
policy update both failed in spaces without local ACL and would have lost the durable Capability provenance needed by
the background scheduler. The bounded due-policy loop now resolves each Capability by the existing composite grant
primary key before source admission; no unbounded scan or new per-source list query was introduced. The added policy
grant index supports grant-scoped audit and cleanup access patterns.

## Verification

- Red tests first demonstrated the missing OpenAPI operation id, Capability registrations, product operation, facade,
  Console route, and generated request contract.
- `pnpm --filter @knowledge/api exec vitest run src/source-product-handlers.test.ts src/dify-capability-v2.test.ts`
  passed, including request-boundary and child-resource authorization cases.
- A red source-product handler regression test reproduced the integrated-space false 403. The focused
  `src/source-product-handlers.test.ts` run then passed all 20 tests, including acceptance of an exact list grant and
  rejection of a mismatched action without touching the local ACL.
- Red tests first reproduced the service-level local snapshot failure in an integrated space and the missing database
  grant fence. Focused source-connection tests passed (27 tests), covering ACL-free create/get/list, public provenance
  redaction, revoke races before insert and activation, exact action/resource checks on both dialects, create-grant
  provenance retention, independent refresh grants, and legacy compatibility.
- `pnpm --filter @knowledge/api test` passed (4,035 tests; 3 skipped), including Capability-backed connection and
  policy creation, exact action/resource fencing, revocation disablement, legacy compatibility, and selection-aware
  sync.
- `pnpm --filter @knowledge/database test` passed (103 tests), including the paired, marker-loss-replay-safe 0031 and
  0032 migrations, nullable provenance unions, scoped foreign keys, audit indexes, and migration registry coverage.
- `pnpm --filter @knowledge/database typecheck` and `pnpm db:migrations:check` passed.
- `node --test scripts/export-capability-v2-operations.test.mjs` passed.
- `pnpm openapi:export:test` passed.
- `pnpm --filter @knowledge/api typecheck` passed.
- `pnpm --filter @knowledge/api build` passed.
- Targeted Biome checks passed for all changed KnowledgeFS TypeScript and JavaScript files, including the
  selection-aware workflow runtime and logical revision provenance.
- Targeted Dify tests for Capability v2, product operations, DTOs, facade delegation, Console resources, contract
  generation, and controller schema registration passed (the focused runs covered 112 tests and a broader run passed
  233 of 234 tests).
- Swagger generation regression tests passed (31 tests).
- `packages/contracts` generation, type-check, and tests passed (9 tests).
- `vp check` passed for the generated KnowledgeFS contract files and their smoke test.
- Targeted Ruff and Pyrefly checks passed.
- KFS OpenAPI export was inspected to confirm the operation id, 8-255 character required `Idempotency-Key`, bounded
  discriminated bodies, and HTTP 202 response.
- The `deploy/konwledge` KnowledgeFS CI surface passed locally: dependency/secret audits, type checks, 4,035 API tests,
  migration registry and API migration baselines, build, full backend lint, evaluation, OpenAPI, migration, Compose,
  Docker-context, and image-smoke contract checks. The repository-wide branch coverage result was 89.94%; per request,
  that threshold was recorded but did not block publication.
- The workflow's Dify integration surface passed Ruff, Pyrefly, Mypy, contract generation, and 999 focused unit tests.
  The Dify Agent integration passed Ruff, BasedPyright, and all 7 focused tests.

## Known risks and follow-up

- Migrations 0031 and 0032 must be applied to an existing local database before browser-level source connection and
  sync-policy verification; this implementation did not restart or mutate the shared development server.
- The generated Capability operation document now contains all 79 operations exported by the TypeScript registry.
  The prior checked-in document contained only 63, so this deterministic regeneration includes existing source and
  logical-document operations in addition to the new durable import operation.
