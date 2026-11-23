---
name: delete-comment
description: Audit and remove code comments in Dify. Use for /delete-comment, comment cleanup, comment classification, moving design rationale into ADRs, or reducing the no-new-comments backlog.
---

# Delete comments

1. Read the nearest AGENTS.md and `docs/adr/0001-comment-ratchet.md`. Read the source, callers, tests, and relevant history before classifying prose. Follow the backend architecture reading requirements before changing API files.
2. Choose a bounded scope. Generate a full backlog with `python3 scripts/check_no_new_comments.py --inventory /tmp/comment-inventory.json`. Treat pending entries as unreviewed, not automatically classified. Report excluded extensions and generated-code limitations.
3. Classify each reviewed comment using evidence from its owner:
   - Tautology: repeats an operation, name, type, or return value. Delete it.
   - Stale: conflicts with current code or describes abandoned code. Verify the mismatch and delete it.
   - Excuse: explains away a concrete implementation defect. Create an issue with the exact path, behavior, impact, and acceptance criteria; then delete the comment. Link an existing matching issue instead of duplicating it. Do not label legitimate compatibility decisions as hacks merely because they use a fallback.
   - Decision Record: explains a non-obvious choice or constraint. Create or update a focused ADR with context, decision, consequences, and owning source paths; then remove the source comment.
4. Retain legal notices and machine-consumed directives. Do not delete Python docstrings, generated contracts, configuration examples, string literals, or embedded source merely because they resemble comments. Expand parser coverage before claiming to audit unsupported languages.
5. Record path, original line, original text, category, action, evidence, and ADR/issue link in a small JSON audit under `docs/comment-audit/`. Count adjacent line-comment nodes consistently. Never claim the whole backlog has been reviewed when only a batch was reviewed.
6. Preserve runtime behavior. Compare syntax with comment ranges removed and run targeted existing checks. Test parser changes with `python3 -m unittest discover -s scripts/tests -p 'test_no_new_comments.py'`. Run the guard with `--base-rev <target-revision>` or `--staged`. Do not inflate an allowance or add a blanket exemption to pass.
7. Regenerate the inventory. Report physical comment-only lines separately from mixed code/comment lines and net PR line count; ADRs and tooling add lines too. Commit the repository skill with its consumers and report the completed scope and remaining backlog.

Use `$delete-comment` where the client uses dollar-prefixed skill invocation; `/delete-comment` is an intent this skill handles, not a repository-defined slash-command registration.
