# Component Architecture Review

Use the canonical reference for the changed concern. These links share rules; they do not activate the implementation skill or its workflow.

| Concern | Canonical rules |
| --- | --- |
| Vertical modules, public entrypoints, data/handler placement, wrappers, Props, and types | [Ownership] |
| Local/Jotai state, form drafts, route identity, URL state, and persistence | [State] |
| Effects, navigation, memoization, and subscriptions | [Runtime] |
| Hotkeys, focus, and secondary surfaces | [Interactions] |

## Root-To-Leaf State And Props Audit

For a file-focused component review, use the named component as the root. For a pending diff, use each changed page, feature entrypoint, or nearest behavior owner whose state or props contract changed.

1. Build the locally owned rendered component tree from each root to every leaf. Follow imported feature components, conditional branches, lists, portals, dialogs, drawers, and popovers. Stop at third-party or Dify UI primitives and explicit stable public feature boundaries, but record the props passed across that final edge.
2. At every component, inventory state sources: React state/reducers, form state, URL state, context/store/Jotai reads and writes, queries, mutations, refs that hold workflow state, and custom-hook results.
3. For every state value, derived fact, and handler, record its consuming branches and required lifetime, including persistence across descendant unmounts. Assess its placement against [Ownership] and [State], including their coordination and persistence exceptions.
4. Inspect every props edge. Mark values that are read by the child, forwarded unchanged, renamed, recomputed, mirrored into local state, or paired with lifecycle fields such as `data/pending/error/retry` and `open/onOpenChange`.
5. Trace what each forwarding parent actually owns before reporting an unnecessary intermediary. Apply [Ownership] to distinguish required coordination or persistence from merely redistributing workflow fields, and [State] to determine whether a feature graph is warranted.
6. Remove unused or redundant props at their source. Do not accept replacing many props with a props bag, context, or hook result unless that abstraction becomes the real owner and gives consumers a narrower contract.

Review the complete paths before concluding that a state or prop is necessary. When several edges share one ownership defect, report one finding at the highest incorrect owner and include a representative path such as `Root -> Section -> Leaf`; do not emit a duplicate finding for every child.

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
