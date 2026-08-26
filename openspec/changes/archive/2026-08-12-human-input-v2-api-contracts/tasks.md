## 1. Accepted And Landed Contract Assets

- [x] 1.1 Retain the shared Pydantic request / response models, transport enums, and controller-facing contract helpers already present in `api/controllers/common/human_input_v2_contracts.py`, `api/controllers/common/human_input_v2_migration.py`, and related controller tests under `api/tests/unit_tests/controllers/common/`.
- [x] 1.2 Retain the controller namespace split and route scaffold already present for workspace console, draft debug, public runtime, authenticated Contact runtime, trusted service runtime, and node-data migration under `api/controllers/console/`, `api/controllers/web/`, and `api/controllers/service_api/app/`, without claiming those routes are fully wired to business services.
- [x] 1.3 Retain the accepted persistence shape already present in `api/models/human_input_v2.py`, including IM integration / binding state, form / grant / endpoint / submission / audit records, and the hashed OTP proof-session migration in `api/migrations/versions/2026_07_25_1300-9c2e5f7a1b3d_add_human_input_v2_otp_proof_session.py`.
- [x] 1.4 Retain repository / domain contract evidence for forms, grants, endpoints, OTP proof sessions, submission atomicity, contact directory, and IM control plane under `api/tests/unit_tests/core/human_input_v2/`, `api/tests/unit_tests/repositories/human_input_v2/`, and `api/tests/integration_tests/repositories/human_input_v2/`.

## 2. Final Normative Contract Scope

- [x] 2.1 Keep `human-input-console-management-api`, `human-input-runtime-form-api`, and `human-input-ee-admin-api` as the final normative API delta to be synced into living specs on archive.
- [x] 2.2 Merge the accepted PRD corrections into this final contract delta: internal / external same-email coexistence, Dynamic Email staying EmailAddress-backed, `all_workspace_contacts`, and scope-aware IM identity reuse.
- [x] 2.3 Keep latest-only sync, complete `integration_id + config_version` CAS, v1 / v2 route isolation, and the narrow EE façade boundary as normative contract decisions rather than implementation checklists.

## 3. Scope Transfer To Explicit Owners

- [x] 3.1 Transfer Contact / External Contact management implementation responsibility to `WTA-1267`; this change keeps only the contract surface.
- [x] 3.2 Transfer Dify internal HTTP and `OrganizationContactProjectionService` upstream ownership to `WTA-1968`, with EE façade delivery coordinated by `implement-ee-human-input-admin-api`.
- [x] 3.3 Transfer draft `form/preview`, `form/run`, and `message-template/test` backend wiring to `WTA-1969`; keep only the route and DTO contract here.
- [x] 3.4 Transfer runtime dispatch, form creation, submission composition, workflow resume, and end-to-end execution ownership to `WTA-1908`–`WTA-1913` and `implement-human-input-v2-runtime-composition`.
- [x] 3.5 Transfer IM sync delivery, workspace override behavior, and production latest-only UI integration to `WTA-1270` and `integrate-im-contact-sync-end-to-end`; transfer IM management API unification to `WTA-1875`.
- [x] 3.6 Record backend node-data migration implementation as already landed under archived `WTA-1288`, and transfer remaining migration compatibility UI round-trip work to `WTA-1971`.
