---
title: ADR-0002 — Referential integrity is enforced in application code
id: ADR-0002
features: [F-001, F-002, F-003, F-004, F-005, F-006, F-007]
kind: adr
status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered
updated: 2026-09-20
---

# ADR-0002 — Referential integrity is enforced in application code

Status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered

## Context

143 mapped tables carry 357 columns whose names end in `_id`. Eight of those columns declare a SQLAlchemy
`ForeignKey()`, across three model modules: `workflow_comment_replies`, `workflow_comment_mentions`, `messages`,
`message_annotations`, `dataset_api_token_bindings` and `tool_published_apps`
[D: api/models/comment.py; api/models/model.py; api/models/tools.py].

Every other association is a bare `StringUUID` column with no database-level constraint [D: api/models/].

## Decision

Associations between entities are expressed as untyped UUID columns and enforced, where they are enforced at all, by
service-layer code rather than by the database [D: api/models/].

## Alternatives considered

OPEN: not recoverable — the code retains no record of what was rejected.

## Consequences

- No `ON DELETE` rule can fire, so cascade behaviour exists only where a service performs it explicitly
  [D: api/models/model.py:407].
- Orphaned references are possible and cannot be detected by the database.
- Tables can be written independently, which is what makes the `api/tasks/` background writers and the
  `remove_app_and_related_data_task` deletion path possible in their current form
  [D: api/tasks/remove_app_and_related_data_task.py:59].

OPEN: is this a deliberate scalability or migration decision, or an accumulation? Eight foreign keys exist, so the
pattern is not absolute, and nothing explains why those eight are different.
