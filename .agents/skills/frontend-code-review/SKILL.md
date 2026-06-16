---
name: frontend-code-review
description: Review Dify frontend code for correctness, accessibility, component design, dify-ui usage, data/query boundaries, performance, and tests. Trigger for `.tsx`, `.ts`, `.js`, UI, React, Next.js, pending-change, or focused frontend review requests.
---

# Frontend Code Review

## When To Use

Use this skill when the user asks to review, audit, analyze, or sanity-check frontend code under `web/`, `packages/dify-ui/`, or frontend-adjacent TypeScript files.

Supported modes:

- **Pending-change review**: inspect staged and working-tree changes.
- **File-focused review**: inspect explicitly named files or paths.
- **Diff/snippet review**: review pasted diffs or snippets using best-effort references.

Do not use this skill for backend-only code under `api/`; use `backend-code-review` instead.

## Required Context

Before reviewing, read the relevant local contracts:

- `web/AGENTS.md` for Dify frontend workflow, overlays, design tokens, state, and tests.
- `packages/dify-ui/README.md` and `packages/dify-ui/AGENTS.md` when code uses or changes `@langgenius/dify-ui/*`.
- `web/docs/overlay.md` when reviewing dialogs, drawers, popovers, tooltips, menus, selects, comboboxes, or other floating UI.
- `web/docs/test.md` and the `frontend-testing` skill when reviewing tests or testability.
- `karpathy-guidelines` for scope control and focused, verifiable changes.
- `how-to-write-component` when reviewing React component structure, ownership, effects, query/mutation contracts, or memoization.

For any UI, UX, or accessibility review, fetch the latest Web Interface Guidelines before finalizing findings. Treat them as a required baseline, not the complete source of accessibility truth:

```text
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

If the review depends on a current framework, SDK, browser API, or accessibility behavior and local code does not settle it, check the current official docs first. For browser compatibility, deprecation, or behavior-sensitive frontend APIs, verify MDN or the relevant standard.

## Rule Packs

Apply every relevant rule pack:

- [references/accessibility-ui.md](references/accessibility-ui.md) — accessibility, semantic HTML, focus, forms, keyboard, disabled states, copy, and long-content behavior. Combines Web Interface Guidelines with Dify UI, Base UI, MDN, and local primitive contracts.
- [references/dify-ui.md](references/dify-ui.md) — Dify UI primitive usage, Base UI semantics, overlays, forms, tokens, radius mapping, and primitive boundaries.
- [references/component-architecture.md](references/component-architecture.md) — component ownership, props, state, effects, exports, wrappers, and feature organization.
- [references/data-query-contracts.md](references/data-query-contracts.md) — generated contracts, TanStack Query, mutations, workspace/auth/SSR boundaries, URL/local storage state.
- [references/performance.md](references/performance.md) — React/Next performance review rules from Vercel guidance, scoped to real risk.
- [references/testing.md](references/testing.md) — frontend test review rules.
- [references/dify-invariants.md](references/dify-invariants.md) — stable Dify-specific runtime invariants that generic React/a11y rules will not catch.
- [references/code-quality.md](references/code-quality.md) — general TypeScript, styling, naming, and maintainability rules.

## Review Process

1. Identify the review scope. For pending changes, inspect `git diff --stat`, `git diff`, and staged diff if relevant. For file-focused reviews, stay within the named files unless a referenced owner/contract must be read.
2. Read code around the changed lines and the owning module. Do not review by isolated snippets when nearby ownership, labels, query inputs, or overlay structure decide correctness.
3. Check user-visible regressions first: accessibility, broken interaction, auth/permission leaks, query/hydration errors, data loss, navigation mistakes, and impossible states.
4. Then check maintainability and performance: ownership, effects, wrappers, memoization, bundle/waterfall risks, tests, and design-system drift.
5. Report only actionable findings. Do not list speculative risks, style preferences, or broad refactors unless they are directly tied to a reproducible issue in scope.

## Severity

- **P0**: security/privacy/auth leak, data loss, production crash, inaccessible critical flow, or broken primary workflow.
- **P1**: user-visible regression, hydration/SSR failure, invalid API/query contract, broken keyboard/focus behavior, or serious design-system/a11y violation.
- **P2**: maintainability or performance issue likely to cause bugs, duplicated state, incorrect ownership, missing tests for risky behavior, or non-critical a11y issue.
- **P3**: minor cleanup with clear value. Omit unless the user asked for a thorough audit.

## Output Format

Lead with findings, ordered by severity. Use this structure:

```markdown
## Findings

- [P1] Short issue title
  File: `path/to/file.tsx:123`
  Why it matters and how to reproduce or reason about it.
  Suggested fix: concrete fix direction.

## Open Questions

- Question or assumption, if any.

## Summary

Brief secondary context. Mention tests not run or residual risk.
```

Rules:

- If there are no findings, say `No issues found.` and mention any test gaps or residual risk.
- Always include file and line when available.
- Keep findings concrete and reproducible.
- Do not include praise sections by default.
- Do not ask to apply fixes unless the user explicitly wants review plus implementation.
