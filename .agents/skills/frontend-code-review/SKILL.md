---
name: frontend-code-review
description: Use only when the user explicitly requests a review or audit of frontend code under `web/` or `packages/dify-ui/`. Supports pending-change, file-focused, and pasted-diff reviews. Do not use for implementation-only requests, diagnosis without review intent, or backend-only code.
---

# Frontend Code Review

Review the requested scope for concrete, reproducible regressions. This skill owns the review phase and routes directly to its bundled rule packs. For a combined review-and-fix request, establish findings before applying implementation or testing guidance.

## Evidence First

1. Establish the review scope from the requested files or current diff.
2. Read the changed lines, their behavior owner, and the nearest scoped `AGENTS.md`.
3. Trace public consumers, generated contracts, primitive APIs, or runtime configuration only when they decide correctness.
4. Report only findings tied to an observable failure, violated contract, security boundary, or demonstrated maintenance risk.

## Rule Routing

Read only the packs matched by the diff:

- DOM semantics, focus, keyboard, forms, disabled state, or visible interaction: [`references/accessibility-ui.md`][accessibility]
- Dify UI imports, Base UI wrappers, overlays, tokens, or primitive contracts: [`references/dify-ui.md`][dify-ui]
- Component ownership, props, state, Effects, navigation, or module boundaries: [`references/component-architecture.md`][component-architecture]
- Generated clients, Query, mutations, auth, SSR, URL state, or persistence: [`references/data-query-contracts.md`][data-query]
- Test files or a concrete missing-regression-test finding: [`references/testing.md`][testing]
- Bundle, waterfall, rendering, or subscription cost supported by evidence: [`references/performance.md`][performance]
- Stable Dify runtime invariants in the named paths: [`references/dify-invariants.md`][dify-invariants]
- General TypeScript or styling quality not owned above: [`references/code-quality.md`][code-quality]

Read `packages/dify-ui/README.md`, `packages/dify-ui/AGENTS.md`, `packages/dify-ui/docs/overlays.md`, or `web/docs/test.md` only when the reviewed code falls under that contract. Check current official documentation when local code and bundled references do not settle a framework, browser, or accessibility behavior.

## Severity And Output

- **P0**: security or privacy leak, data loss, production crash, or inaccessible critical workflow.
- **P1**: user-visible regression, invalid API or authorization contract, hydration failure, or broken primary interaction.
- **P2**: concrete maintainability, performance, test, or accessibility defect likely to cause incorrect behavior.
- **P3**: minor actionable cleanup; omit unless the user requested a thorough audit.

Lead with findings ordered by severity. Include a tight file and line reference, the failing contract or reproduction path, impact, and a concrete fix direction. If there are no findings, say `No issues found.` and state any material verification gap. Do not add praise sections, speculative risks, or an unsolicited offer to implement fixes.

[accessibility]: references/accessibility-ui.md
[code-quality]: references/code-quality.md
[component-architecture]: references/component-architecture.md
[data-query]: references/data-query-contracts.md
[dify-invariants]: references/dify-invariants.md
[dify-ui]: references/dify-ui.md
[performance]: references/performance.md
[testing]: references/testing.md
