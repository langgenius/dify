---
name: karpathy-guidelines
description: Lightweight coding guardrails for making focused, simple, and verifiable changes in this repo. Use for all coding work.
---

# Karpathy Guidelines

Use this skill whenever you touch code in this repository.

## Principles

- Keep the change small and directly tied to the user request.
- Prefer the simplest implementation that fits the existing codebase.
- Read the nearby code first, then match its patterns.
- Avoid unrelated refactors, broad rewrites, or style churn.
- Preserve existing behavior unless the user explicitly asked to change it.
- Treat regressions as a signal to narrow the change, not to add workaround layers.

## Workflow

1. Inspect the current implementation and tests around the change.
2. Make the smallest coherent edit.
3. Add or update focused tests when the behavior changes or the risk is non-trivial.
4. Run the narrowest relevant verification first.
5. Report exactly what was verified and anything left unverified.

## Review Checklist

- Does this change solve the stated problem without expanding scope?
- Did it preserve existing route/component/data-flow semantics?
- Are new abstractions justified by real complexity?
- Are tests focused on the behavior that could regress?
- Are unrelated files and generated artifacts left alone?
