# ADR 0001: Ratchet explanatory code comments into decisions and issues

Status: Accepted for incremental adoption
Date: 2026-11-23

## Context

Explanatory comments can duplicate code, drift from it, or normalize a workaround. The existing repository is too large to classify safely in one change. Executable directives and legal notices have obligations that prose cleanup must preserve.

## Decision

Reject newly introduced explanatory comment tokens with `scripts/check_no_new_comments.py`. Compare exact comment text and occurrence counts within each file against the Git base. Existing occurrences can remain or move within the same file; copies, edited comments, and cross-file moves require review and fail the guard. Deletions immediately reduce the next PR's allowance. There is no editable baseline file to inflate.

Classify reviewed prose as Tautology, Stale, Excuse, or Decision Record. Delete Tautology/Stale comments. Delete Excuse comments only with a concrete issue describing the problematic behavior and acceptance criteria. Move non-obvious decisions into a discoverable ADR that names its owning source files. Preserve runtime behavior during a cleanup. Save the classification and action in `docs/comment-audit/`.

Preserve tool directives and legal notices. Python docstrings are runtime strings and API contracts, not comment tokens; this rule does not delete or ban them. Markdown, Gherkin scenarios, shell/configuration examples, and generated artifacts are not a prose-deletion target. Do not strip examples or commented configuration as if they were code explanations.

## Enforcement and limits

The guard parses tracked Python, JavaScript/JSX/TypeScript/TSX, Go, CSS, HTML, YAML, JSON-family comments in `.json`, Bash `.sh`, and PHP source files using ast-grep. Generated contracts, billing service modules, vendored Monaco/PDF workers, the generated embed bundle, and files ending `.gen.ts` / `.generated.ts` are excluded. The inventory lists all excluded extensions; TOML, Dockerfiles, SQL, PowerShell, extensionless scripts, embedded languages, docstrings, and configuration templates remain outside this first parser coverage. Expanding coverage requires parser fixtures, a fresh inventory, and review, not regex-based deletion. No claim is made that every repository comment has been classified.

Run `python3 scripts/check_no_new_comments.py --base-rev <target-revision>` for local tracked working changes or `--staged` for the index. CI compares the checked-out PR merge commit to its first parent, and merge-queue commits to the supplied merge-group base. The dedicated main-CI job runs for every PR and merge-group event, independently of file classification. Tests exercise both parsers and Git/index behavior.

Run `python3 scripts/check_no_new_comments.py --inventory /tmp/comment-inventory.json` to regenerate the complete in-scope backlog. Inventory entries have `category: null` until reviewed; machine guesses must not be presented as human classification. The initial reviewed batch covers all production sources in `web/utils/`, with test sources deferred. Use the repository `delete-comment` skill to continue.

## Consequences

Decisions are discoverable by source path in `docs/adr/`; issues retain actionable debt without excusing it in source. New explanatory comments require conversion into code, an ADR, or an issue. The rule deliberately retains old prose until its context has been examined. Protected directives still require ordinary review; their exemption does not authorize new suppressions. A branch protection administrator must require the new Comment Ratchet check if it is to block merging independently of other required checks.
