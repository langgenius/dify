---
title: Implementation Status Model — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Implementation Status Model — Dify

> One state machine, four documents. This file is the only definition of what a
> status word means; the domain, PRD, tasks and test documents carry the states
> but never redefine them.

## The states

Four, and only these four. A cell holding anything else is a defect the route's
own check fails on, because a vocabulary nobody agreed to is worse than no
status at all — it reads as information and carries none.

| State | Means | Required alongside |
| --- | --- | --- |
| `todo` | Agreed, not started. | nothing |
| `wip` | Someone is working on it now, or it is written but unproven. | nothing |
| `blocked` | Cannot proceed. | a reason, in the note |
| `done` | Delivered **and** proven here. | evidence, in the note or the Evidence/Artifact cell |

Written as the bare word, optionally followed by ` — <note>`:

```
| F-nnn-T7 | done — go test ./policy/... green, 94% | `platform/gateway/policy/` |
| F-nnn-T8 | blocked — waiting on ADR-nnnn (ramp fail-closed direction) | — |
```

## The transitions

```
        ┌─────────────────── reopened ◀──────────────────┐
        ▼                                                │
     todo ──────▶ wip ──────────────────────────────▶ done
        ▲          │  ▲                                  
        │          ▼  │                                  
        └──────  blocked                                 
             descoped
```

| From | To | When |
| --- | --- | --- |
| `todo` | `wip` | work starts |
| `wip` | `done` | the done-when check actually passed **here** |
| `wip` | `blocked` | a dependency, decision or `OPEN:` question stops it |
| `blocked` | `wip` | the blocker cleared |
| `blocked` | `todo` | descoped back to the backlog, blocker unresolved |
| `done` | `wip` | reopened: a regression, or the evidence turned out not to hold |

**`todo` never jumps straight to `done`.** Not a formality: `done` asserts that a
check passed in this environment, and nothing can have passed a check it never
started. A row that appears as `done` without ever being `wip` is almost always a
status written from intent rather than from evidence, which is exactly the failure
this model exists to catch.

## What `done` costs

`done` is the only state that makes a claim about the world, so it is the only one
that needs backing:

- **tasks** — the done-when check from the row, run here, with the command or
  result in the note. "The code looks finished" is `wip`.
- **user stories** — every acceptance criterion has a passing test case, cited by
  `-TC` ID. A story is never more done than its tests.
- **test cases** — the test exists and passes. A written-but-failing test is `wip`;
  a test that cannot pass without changing a documented contract is `blocked`.
- **domain rules** — a test names the rule ID (`architect_common.md` § Code quality
  requires this), and it passes.

When the environment cannot run the check — no database, no credentials, no
network — the honest state is `wip — unverified, run <command>`. Recording `done`
because it would probably pass is the one thing that makes every other status in
the hub untrustworthy.

## Where status lives

| Document | Carries status for | Where |
| --- | --- | --- |
| `ddd/domain_DOM-nnn-<slug>.md` | each `DOM-nnn-R<k>` rule | § Implementation status |
| `PRDs/prd_<version>_<F-nnn>-<slug>.md` | each `F-nnn-US<k>` story | § Implementation status |
| `tasks/tasks_<version>_<F-nnn>.md` | each `F-nnn-T<k>` task | Status column of the task table |
| `tests/test_<version>_<F-nnn>.md` | each `F-nnn-TC<k>` case | § Implementation status |

Status rolls **up**, never down: a story is `done` when its test cases are, a rule
is `done` when the test naming it passes. Nothing sets a parent `done` on its own
authority — if the roll-up disagrees with the cell, the cell is wrong.

## Who writes it

`docs_flow.py task --id <ID> --state <state>` is the writer, for every one of the
four documents. Hand-editing a status cell is not forbidden, but the subcommand
checks the transition against the table above and refuses an illegal one, which
is the point of having a machine at all.

Reading it back:

```bash
python <spec>/route/route.py --version <v> --id <F-nnn>
```

prints the roll-up across all four documents and fails on an unknown state word.
