## Summary

<!-- What changed and why? Keep this human-written; do not paste raw AI output. -->

## Source / Vibe Coding Disclosure

- [ ] I used AI/vibe coding assistance.
- [ ] I did not use AI/vibe coding assistance.

If AI/vibe coding was used, describe:

- Tool/model:
- What was generated:
- What I personally inspected or rewrote:
- Known uncertainty / areas needing reviewer attention:

## Risk

- [ ] risk:low — docs/tests/UI copy/small isolated change
- [ ] risk:medium — user-visible behavior, API contract, non-critical service logic
- [ ] risk:high — auth, tenant isolation, billing, migrations, deployment, secrets, data safety

## Validation

Commands run locally:

```text
# paste commands and relevant output
```

For UI changes:

- [ ] Screenshot or recording attached.
- [ ] i18n keys updated; no new hardcoded user-facing strings.

For API/backend changes:

- [ ] Tests added or updated.
- [ ] Tenant/workspace permission boundaries checked where relevant.

## Reviewer Checklist

Reviewer must confirm before approval:

- [ ] I read the diff myself instead of approving based only on the PR description.
- [ ] I checked for unnecessary AI-generated abstraction, duplicated code, dead code, and hallucinated APIs.
- [ ] I verified the stated tests or asked for missing verification.
- [ ] I checked security-sensitive surfaces when touched: auth, tenant isolation, secrets, billing, migrations, deployment.
- [ ] I left comments for unclear logic, risky assumptions, or missing tests.

## Release / Rollback Notes

- Release impact:
- Rollback approach:
- Follow-up issues:
