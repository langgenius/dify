# Builder Confirmed Test Run Reliability Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. The user explicitly approved GPT parallel execution on 2026-10-17; this records that authorized scope rather than requesting another design approval.

**Goal:** Eliminate false autosave conflicts, stale target confirmations, and repeated real execution after recovery.

**Architecture:** Reuse ordinary native Test Run, persisted Builder context and existing Run records. Canonicalize only graph ordering that has no execution meaning; bind confirmations to the displayed disclosure; persist a launch reservation before native execution and reconcile rather than replay.

**Tech Stack:** Dify API, Python, SQLAlchemy, PostgreSQL, pytest, existing Docker Compose and Kubernetes deployments.

**Spec:** The user's 2026-10-17 execution request and AGENTS.md “Confirmed Test Run: product direction”.

## Global constraints

- Code may network through the existing runtime. No new sandbox, risk engine, cross-repository prerequisite or frontend implementation.
- Preserve genuine graph changes, Workspace permissions, destructive-operation restrictions and selective Mock behavior.
- Never infer exactly-once external delivery from a timeout or missing acknowledgement.
- Verify Local before Dev; record actual source/runtime revisions, screenshots and redacted Trace in Linear. Keep unverified work In Progress.

## Ownership and review focus

| Task | Owner files | Regression checks |
| --- | --- | --- |
| 409 | revision.py and revision tests | Identical node sets reordered by autosave remain equal; changed executable config, root selection, nested arrays and meaningful edges remain distinct. |
| Confirmation | effect_disclosure.py, handlers_fix.py, narrow handlers_edit.py adaptations, models.py/serde.py form snapshot | Old form cannot approve changed endpoint, headers or credential selection; intentional test input entry remains supported; unchanged confirmation works. |
| Replay | dify_port.py full-run owner, handlers_build.py, recovery owners and tests | Launch reservation survives interruption, concurrent delivery and lost acknowledgement; recovery never starts a second native Run. |
| Integration | Root; port account metadata helper, CI inventory, deployment and evidence | Shared interfaces agree; prior sessions decode safely; no credentials enter disclosure snapshots or evidence. |

## Execution

- [ ] Each implementer writes and runs a failing regression, then makes the smallest passing change and reports exact commands.
- [ ] Root integrates shared interfaces and reviews the combined diff; independent GPT reviewers check specification and correctness.
- [ ] Run targeted units, relevant database integration checks and normal exact-head CI. Register new testcase inventories without dropping existing cases.
- [ ] Exercise actual Local runtime with synthetic data and controlled destinations, including autosave, stale form and recovery boundaries. Capture screenshots and redacted trace.
- [ ] Push approved branch changes, build normal images, update normal Dev deployment, verify actual Pods and repeat E2E.
- [ ] Attach evidence and limitations to ENG-1196 / ENG-1184; change status only for genuinely accepted scope.
