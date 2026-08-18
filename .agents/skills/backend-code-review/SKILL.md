---
name: backend-code-review
description: Use only when the user explicitly requests a review or audit of backend code under `api/`. Supports pending-change, file-focused, and pasted-diff reviews. Do not use for implementation-only requests, diagnosis without review intent, frontend code, or backend code outside `api/`.
---

# Backend Code Review

Review the requested scope for concrete, reproducible defects. The nearest `AGENTS.md` owns package facts and commands; this skill owns the review workflow and routes to its bundled rule packs.

## Evidence First

1. Establish the requested review scope and inspect the relevant diff or files.
2. Read the changed lines, their behavior owner, nearby tests, and local docstrings or comments that define contracts.
3. Trace callers, persistence boundaries, authorization, generated schemas, or external I/O only when they decide correctness.
4. Report only findings tied to an observable failure, violated contract, security boundary, data integrity risk, or demonstrated maintenance problem.

## Rule Routing

Read only the packs matched by the diff:

- Models or migrations: [`references/db-schema-rule.md`][db-schema]
- Controller, service, core/domain, library, or model dependency direction: [`references/architecture-rule.md`][architecture]
- Table access outside an established repository boundary: [`references/repositories-rule.md`][repositories]
- SQLAlchemy sessions, queries, transactions, CRUD, concurrency, or raw SQL: [`references/sqlalchemy-rule.md`][sqlalchemy]

When no pack applies, review correctness, security, behavior changes, and test evidence directly. Check current official documentation only when local code and contracts do not settle framework or library behavior.

## Severity And Output

- **P0**: security or privacy exposure, data loss, or a production-wide outage.
- **P1**: user-visible regression, broken authorization or tenant isolation, invalid public contract, or failed primary workflow.
- **P2**: concrete correctness, performance, maintainability, or test defect likely to cause incorrect behavior.
- **P3**: minor actionable cleanup; omit unless the user requested a thorough audit.

Lead with findings ordered by severity. Include a tight file and line reference, the failing contract or reproduction path, impact, and a concrete fix direction. If there are no findings, say `No issues found.` and state any material verification gap. Do not add praise sections, speculative risks, or an unsolicited offer to implement fixes.

[architecture]: references/architecture-rule.md
[db-schema]: references/db-schema-rule.md
[repositories]: references/repositories-rule.md
[sqlalchemy]: references/sqlalchemy-rule.md
