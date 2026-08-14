# Retirement

- Reason: The change accumulated implementation and roadmap responsibilities beyond its original contract scope.
- Normative specifications: `openspec/specs/human-input-console-management-api/`, `openspec/specs/human-input-runtime-form-api/`, `openspec/specs/human-input-ee-admin-api/`
- Roadmap and delivery status: Linear project `HITL IM 支持`
- Implementation ownership: Focused OpenSpec changes and Linear leaf issues listed below
- Archiving this change does not imply completion of transferred implementation work.

## Requirement / Task Mapping

| Former scope slice | Status | Evidence or successor |
| --- | --- | --- |
| Shared Pydantic DTOs and transport contract helpers (`former 1.1-1.3`) | `accepted-and-landed` | `api/controllers/common/human_input_v2_contracts.py`, `api/controllers/common/human_input_v2_migration.py`, controller contract tests |
| Route scaffold and namespace split for console / web / service / migration surfaces | `accepted-and-landed` | `api/controllers/console/workspace/human_input.py`, `api/controllers/console/app/workflow_human_input_v2.py`, `api/controllers/web/human_input_form*.py`, `api/controllers/service_api/app/human_input_form.py` |
| IM integration / binding / form / grant / endpoint / audit persistence shape | `accepted-and-landed` | `api/models/human_input_v2.py`, OTP migration, repository/domain tests |
| Final API contracts for console / runtime / EE façade | `normative-spec` | this change `specs/`, to be synced into living specs on archive |
| Contact / External Contact implementation (`former 2.1-2.8`) | `linear-owned` | `WTA-1267` |
| IM sync / override delivery (`former 3.1-3.4`) | `linear-owned` | `WTA-1270` |
| IM management API unification | `linear-owned` | `WTA-1875` |
| Draft `form/preview`, `form/run`, `message-template/test` implementation (`former 4.3-4.5`) | `linear-owned` | `WTA-1969` |
| Runtime form implementation and submit wiring (`former 5.1-5.7`) | `linear-owned` | `WTA-1908`, `WTA-1909`, `WTA-1910`, `WTA-1911`, `WTA-1912`, `WTA-1913` |
| Dify internal HTTP upstream and Organization Contact projection (`former 6.1-6.4`) | `linear-owned` | `WTA-1968` |
| EE façade delivery (`former 6.5-6.6`) | `focused-change-owned` | `openspec/changes/implement-ee-human-input-admin-api/` |
| Backend node-data migration implementation assumptions (`former 4.1-4.2`) | `superseded` | archived `WTA-1288` already landed the corrected helper semantics |
| Migration compatibility UI round-trip after helper landing | `linear-owned` | `WTA-1971` |

## Main Successors

- Contact API: `WTA-1267`
- Dify internal HTTP + Organization Contact projection: `WTA-1968`
- draft preview/run and `message-template/test`: `WTA-1969`
- IM card handled-status update: `WTA-1970`
- migration compatibility round-trip: `WTA-1971`
- runtime composition and execution: `WTA-1908` / `WTA-1909` / `WTA-1910` / `WTA-1911` / `WTA-1912` / `WTA-1913`
- IM API unification: `WTA-1875`
- sync and override delivery: `WTA-1270`
- focused EE façade plan: `openspec/changes/implement-ee-human-input-admin-api/`
