---
name: frontend-code-review
description: "Reviews React and TypeScript frontend code for conditional classname handling, Tailwind-first styling, prop memoization, React Flow hook usage, and workflowStore misuse. Trigger when the user asks to review, audit, or check frontend files (`.tsx`, `.ts`, `.js`), requests a code review, PR review, component review, or says 'review this component'. Supports pending-change reviews and focused file reviews."
---

# Frontend Code Review

## Intent
Use this skill whenever the user asks to review frontend code (especially `.tsx`, `.ts`, or `.js` files). Support two review modes:

1. **Pending-change review** – inspect staged/working-tree files slated for commit and flag checklist violations before submission.
2. **File-targeted review** – review the specific file(s) the user names and report the relevant checklist findings.

Stick to the checklist below for every applicable file and mode.

## Checklist
See [references/code-quality.md](references/code-quality.md), [references/performance.md](references/performance.md), [references/business-logic.md](references/business-logic.md) for the living checklist split by category—treat it as the canonical set of rules to follow.

Flag each rule violation with urgency metadata so future reviewers can prioritize fixes:
- **Urgent** — causes runtime errors, blank screens, or silent data loss (e.g., using `workflowStore` inside a node component where no provider exists)
- **Suggestion** — deviates from project conventions or creates maintainability risk but does not break functionality (e.g., inline ternary for classnames instead of `cn()`)

## Review Process
1. Open the relevant component/module. Scan for class name construction, React Flow hook usage, prop memoization, and styling approach.
2. For each checklist rule, check whether the code violates it. Capture a representative snippet for each violation. Example violations:
   - **Conditional classnames without `cn()`**: `className={isActive ? 'text-primary-600' : 'text-gray-500'}` — should use `cn()` from `@/utils/classnames`
   - **Inline object prop causing re-renders**: `<HeavyComp config={{ provider, detail }} />` — should wrap in `useMemo`
   - **workflowStore in node component**: `import useNodes from '@/app/components/workflow/store/workflow/use-nodes'` — should use `import { useNodes } from 'reactflow'`
3. Compose the review section per the template below. Group violations first by **Urgent** flag, then by category order (Code Quality, Performance, Business Logic).

## Required output
When invoked, the response must exactly follow one of the two templates:

### Template A (any findings)
```
# Code review
Found <N> urgent issues need to be fixed:

## 1 <brief description of bug>
FilePath: <path> line <line>
<relevant code snippet or pointer>


### Suggested fix
<brief description of suggested fix>

---
... (repeat for each urgent issue) ...

Found <M> suggestions for improvement:

## 1 <brief description of suggestion>
FilePath: <path> line <line>
<relevant code snippet or pointer>


### Suggested fix
<brief description of suggested fix>

---

... (repeat for each suggestion) ...
```

If there are no urgent issues, omit that section. If there are no suggestions, omit that section.

If the issue number is more than 10, summarize as "10+ urgent issues" or "10+ suggestions" and just output the first 10 issues.

Don't compress the blank lines between sections; keep them as-is for readability.

If you use Template A (i.e., there are issues to fix) and at least one issue requires code changes, append a brief follow-up question after the structured output asking whether the user wants you to apply the suggested fix(es). For example: "Would you like me to use the Suggested fix section to address these issues?"

### Template B (no issues)
```
## Code review
No issues found.
```

