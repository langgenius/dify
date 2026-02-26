---
name: frontend-code-review
description: "Trigger when the user requests a review of frontend files (e.g., `.tsx`, `.ts`, `.js`). Support both pending-change reviews and focused file reviews while applying the checklist rules."
---

# Frontend Code Review

## Intent
Use this skill whenever the user asks to review frontend code (especially `.tsx`, `.ts`, or `.js` files). Support two review modes:

1. **Pending-change review** – inspect staged/working-tree files slated for commit and flag checklist violations before submission.
2. **File-targeted review** – review the specific file(s) the user names and report the relevant checklist findings.

Stick to the checklist below for every applicable file and mode.

## Checklist
See [references/code-quality.md](references/code-quality.md), [references/performance.md](references/performance.md), [references/business-logic.md](references/business-logic.md) for the living checklist split by category—treat it as the canonical set of rules to follow.

Flag each rule violation with urgency metadata so future reviewers can prioritize fixes.

## Review Process
1. Open the relevant component/module. Gather lines that relate to class names, React Flow hooks, prop memoization, and styling.
2. For each rule in the review point, note where the code deviates and capture a representative snippet.
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

