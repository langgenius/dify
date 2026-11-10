# ENG-1185 execution ledger

Base: `70ed2fbbfc2bf65104a7b0b27938f364d16aa9db`; approved scope: three remaining backend behaviours. Design/plan initial commit `38129057d5`.

## Preflight and shared-interface scan

| Tasks | Shared interface or invariant | Resolution |
| --- | --- | --- |
| 1 / 2 | logical task identity vs execution generation | Stable task identity helper; Stop/Resume generation remains independent. |
| 1 / 3 | Run lineage | Add domain default, nullable persistent column and locked write mapping; do not rewrite historical Runs. |
| 2 / 3 | stop and cancellation settlement | Reuse frozen stop/observe helpers; explicit intent first, then atomic Stop; pending/unknown never activate. |
| 2 / 4 | clear responses/public reads | Dedicated no-graph lifecycle receipt/view; root guards direct SSE forwarding. |
| 3 / 4 | intake and generic decision | Intake envelope plus standard existing create-Fix SessionView; root routes early control actions. |
| 1 | completion vs publication truth | Six actual keep/publish exits only; output declarations are not observed results. |
| 2 | context reset vs private evidence | Permanent cleared Session, public history isolation; immutable Run/audit retention. |
| 3 | current completed task | No Stop for completed/idle/settled-abandoned; preserve previous Completed outcome. |
| 4 | schema and existing clients | Additive contracts and documented integration; no frontend UI implementation. |
| 5 | acceptance and release | Local, full CI, official same-source image, safe schema-aware Dev rollout and evidence. |

## Decisions

- User's established parallel GPT execution takes precedence over the generic sequential implementation default. File ownership is split; root owns integration and review.
- Existing linked worktree is reused; unrelated untracked `storage/` and XML are untouched. Targeted baseline: 220 passed, 2 existing warnings.
- Clear permanently tombstones the old Session; a new conversation uses the existing creation endpoint. Abandon may accept a new task in the same Session only after safe settlement.
- Explicit confirmed Fix intent is saved before Stop rather than using cross-owner SQL callbacks. Cost: a crash can leave a `stopping` intent while the old task still runs; repeated explicit confirmation reconciles it. No read silently executes the next task.
- Legacy attachment receipts keep their execution-generation scope; they are not authoritative logical Task lineage.

## Tasks

- Task 1: implementation and independent review complete; 107 focused tests passed.
- Task 2: implementation and review complete; 104 focused, 200 related, 15 PostgreSQL/Redis checks passed.
- Task 3: implementation complete; 32 focused/migration/PostgreSQL checks passed.
- Task 4: integrated; 309 related route/runtime checks, 85 full-run checks and the new first-Fix service case passed.
- Task 5: final production review passed (141 independent tests); full Builder suite 8021 passed; stream-replay follow-up independently tested and 183 related tests passed. Local final candidate 4266443ef44e (37 frozen sources) deployed on schema 6c84f1d90235. Real application acceptance in progress; CI/Dev pending.

## Independent review corrections

- Unknown immutable Run evidence cannot become settled during abandon; shared execution-settlement predicate blocks fresh goals and Fix activation.
- Fresh-goal activation checks current DSL binding under the Session/Workflow write transaction.
- A new request for the same historical failed Run in a later Task gets a new offer; only the same original request identity replays the old intent.
- First Fix Session and its immutable source Run commit atomically.
- Local apply revalidates all four prepared container IDs/images before any mutation.
- Existing frontend processing gate cannot yet submit the new unrelated-Fix Decision; recorded as frontend integration scope, not claimed passing.

## Local candidate qualification

- Initial additive migration and rollout completed with all four roles healthy; no historical unknown replay.
- Follow-up corrects only settle-only `send_edit_goal` replay terminal emission (no extra dispatch), with observed red/green and independent review. Schema unchanged.
- Final Local image: `sha256:4266443ef44e15445b7e4e02bd80f5408631a2a98963e4c4dc4c0e7da9e380d6`; source-set digest: `de1428338432bd87a38f632fafa5ed87578f499ed9e3113049001434aa50eab7`.
- All 51 changed Python files pass Ruff; production type checks pass; import contracts 81 kept/0 broken; response contracts 733 valid/0 mismatch.
- New application acceptance is running on a fresh synthetic App, using the existing owned DeepSeek model configuration. Old auth client refreshed through the native authentication service with unchanged scope/policy; no credential material belongs in public evidence.
