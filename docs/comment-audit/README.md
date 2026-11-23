# Comment cleanup audit

The first ratchet batch uses main revision `0f0913be0d69a203c165709b3f8ec2f85b1beef8` (2026-11-23).

## Inventory and estimate

| Metric | Before this batch | After this batch |
| --- | ---: | ---: |
| Parsed comment nodes | 40,007 | 39,934 |
| Protected directive/legal nodes | 1,865 | 1,865 |
| Ordinary comment nodes | 38,142 | 38,069 |
| Physical lines containing ordinary comments | 40,306 | 40,120 |
| Ordinary comment-only physical lines | 37,520 | 37,340 |

The baseline scans 14,902 tracked files. The estimate of **37,520 lines** is gross potential source-line reduction within the supported parser scope, before writing ADRs or tooling. The remaining gross potential is 37,340 lines. Inline-comment removal changes a line without deleting it; do not count those lines as lines shed. Do not equate comment count with line count, or source-line reduction with net PR size. This infrastructure PR adds more documentation/tooling lines than it removes.

Generated and vendored code, legal notices, tool directives, and Python runtime docstrings are excluded. Unsupported formats are also excluded, including TOML, Dockerfiles, extensionless scripts, SQL, PowerShell, and embedded-language comments. The summary JSON records excluded extensions; it includes documentation and assets as well as unparsed code. These numbers are not an estimate of all comments in every format in the repository.

Reproduce the inventory from the checkout being assessed:

```sh
python3 scripts/check_no_new_comments.py --inventory /tmp/comment-inventory.json
```

The inventory contains the path, line, and full text of every detected comment, with `category: null` for unreviewed entries. Regenerate it rather than checking a large, quickly stale backlog into Git. The raw initial discovery included generated/vendor code and about 47,000 nodes; it is not the governed inventory above.

## Reviewed batch

Every production-source comment under `web/utils/` was reviewed. Test sources remain pending. The ledger preserves original text and line references against the base revision.

| Category | Comment nodes | Action |
| --- | ---: | --- |
| Tautology | 36 | Deleted |
| Stale | 12 | Deleted |
| Excuse | 3 | Deleted; one shared defect tracked in [#46945](https://github.com/langgenius/dify/issues/46945) |
| Decision Record | 22 | Deleted from source; rationale moved to ADRs 0002–0007 |

Two executable directives remain in this scope. The three Excuse nodes are consecutive lines of one explanation, not three separate defects. The batch deletes 73 comment nodes and 180 comment-only physical lines. All 38,069 remaining ordinary nodes are **pending review**, not automatically categorized. Continue with the repository `delete-comment` skill and retain this distinction in future reports.

## Validation

- Eight regression tests cover supported grammars, strings/regex/JSX, runtime docstrings, protected directives, occurrence limits, cross-file copies, parser failures, real Git baselines, staged content, deletions, and reduced future allowances.
- All 19 changed utility files produce identical JavaScript token streams after TypeScript transpilation with comments removed. Whitespace formatting differs around the now-empty catch; emitted program tokens do not.
- Targeted utility lint, formatting, Python Ruff checks, staged comment guard, shell syntax, CI YAML parsing, and skill frontmatter validation pass.
- Full application builds and backend integration tests are not needed for this comment-only utility batch. The dedicated CI job runs on pull requests and merge groups; enforcing its status through branch protection is an administrator setting.

See [ADR 0001](../adr/0001-comment-ratchet.md) for policy, coverage, and invocation details.
