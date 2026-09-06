# Component Architecture Review

Use the canonical reference for the changed concern. These links share rules; they do not activate the implementation skill or its workflow.

| Concern | Canonical rules |
| --- | --- |
| Vertical modules, public entrypoints, data/handler placement, wrappers, Props, and types | [Ownership] |
| Local/Jotai state, form drafts, route identity, URL state, and persistence | [State] |
| Effects, navigation, memoization, and subscriptions | [Runtime] |
| Hotkeys, focus, and secondary surfaces | [Interactions] |

## Apply Rules In Their Actual Scope

Explicit team conventions are reviewable contracts, including module organization and public API boundaries. Check the documented exception before reporting a violation. Do not infer an exception solely because the code appears to work, or invent a user-facing failure for a convention finding.

- For owner placement, trace the consumers and required lifetime. Establish whether the parent coordinates a snapshot, submission, navigation, shared UI, or persistence before asking to move state or handlers.
- For component boundaries, identify the ownership or encapsulation the proposed extraction would improve; file length alone establishes neither.
- For props and types, check the domain contract and public API. Do not report private props typing style alone; declaration/export syntax matters only for a documented package rule or concrete type, export, or framework defect.
- For state and Effects, trace the source of truth, external synchronization target, and mount/reset boundary. Controlledness alone does not prove that a draft is lifted or persisted; follow the form and overlay contracts linked by [State].
- For navigation, distinguish ordinary links from mutation success, guarded redirects, command flows, and submission side effects.

## Preserve Existing Product Contracts

During refactors, trace the interaction being moved through its real consumer. Navigation, sidebar, dropdown, webapp-list, and app-switching changes must preserve expansion controls, hover persistence, pin/delete actions, routing, keyboard/focus handling, and open-state ownership where present.

Check that the changed owner still handles reachable empty, loading, and missing optional-data states, and that primitive wrappers preserve accessible semantics and the public controlled-state contract. Report the actual lost behavior or explicit rule violation; use the package testing policy when assessing regression coverage.

[Interactions]: ../../how-to-write-component/references/interactions.md
[Ownership]: ../../how-to-write-component/references/ownership.md
[Runtime]: ../../how-to-write-component/references/runtime.md
[State]: ../../how-to-write-component/references/state.md
