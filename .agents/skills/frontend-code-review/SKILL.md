---
name: frontend-code-review
description: Review frontend code under `web/` or `packages/dify-ui/` when the user explicitly requests a review or audit. Supports PRs, branches, pending changes, files, and pasted diffs. Do not use for implementation-only requests, diagnosis without review intent, or backend-only code.
---

# Frontend Code Review

Review the requested scope for concrete defects and violations of explicit project contracts. This skill owns review decisions; its references route to canonical rules without activating another skill's implementation workflow.

## Evidence First

1. Resolve the requested target and scope. For a PR or branch, establish its actual base and head; do not assume the tracking branch is the review base. Include local edits only when they belong to the requested scope. Give delegated reviewers the same scope and revisions.
2. Read the changed code, its behavior owner, and the applicable scoped `AGENTS.md`. For a diff review, distinguish introduced or re-exposed defects from unrelated existing issues; a file audit may include existing defects.
3. Trace affected consumers and contracts. When logic is removed or moved, identify the behavior it preserved and where that responsibility now lives. Check affected public types, examples, and tests when they decide correctness.
4. Verify candidates against actual defaults, guards, reachable states, and documented exceptions. Report an observable failure, security boundary violation, or concrete maintenance cost. Explicit team conventions are also contracts: establish their scope without inventing user impact to justify them.

## Rule Routing

Read only the packs for contracts affected by the change, not every topic present in a file:

- Changes to semantics, naming, keyboard/focus, forms, pending states, or responsive interaction: [`references/accessibility-ui.md`][accessibility]
- Changes to Dify UI composition, public API, primitive behavior, or state styling: [`references/dify-ui.md`][dify-ui]
- Changes to component/module ownership, props, state, Effects, or navigation: [`references/component-architecture.md`][component-architecture]
- Generated clients, Query, mutations, auth, SSR, URL state, or persistence: [`references/data-query-contracts.md`][data-query]
- Test files or a concrete missing-regression-test finding: [`references/testing.md`][testing]
- Bundle, waterfall, rendering, or subscription cost supported by evidence: [`references/performance.md`][performance]
- Changes to type boundaries, styling composition, or localized copy not covered above: [`references/code-quality.md`][code-quality]

Follow a known contract directly; use an index only to discover its owner. Project documents define local requirements; installed dependencies and their public APIs establish version-specific behavior. Resolve disagreements with implementation and tests rather than treating existing code as the standard. For unresolved framework, browser, or accessibility behavior, consult current official documentation or standards; use a targeted guidance search when it helps locate them.

## Severity And Output

- **P0**: critical impact requiring immediate intervention, such as widespread unavailability, severe data loss, or a security/privacy breach.
- **P1**: major reachable failure of a primary workflow or public contract that should block delivery.
- **P2**: narrower correctness, accessibility, performance, or test defect; concrete maintenance cost; or a material violation of an explicit project contract.
- **P3**: minor actionable cleanup; omit unless the user requested a thorough audit.

Choose severity by impact, reachability, and recovery, not by topic; accessibility failures are correctness defects. Lead with verified findings ordered by severity. Include a tight file and line reference, the triggering scenario or applicable project rule, and a concrete fix direction. Deduplicate findings with the same cause. State material verification gaps separately; lack of verification is not itself a defect. When no findings remain, say so briefly. Do not add praise sections, speculative risks, or an unsolicited offer to implement fixes.

[accessibility]: references/accessibility-ui.md
[code-quality]: references/code-quality.md
[component-architecture]: references/component-architecture.md
[data-query]: references/data-query-contracts.md
[dify-ui]: references/dify-ui.md
[performance]: references/performance.md
[testing]: references/testing.md
