This PR replaces all `db.paginate` calls with a plain SQLAlchemy pagination helper.

## Motivation

Following the direction of #38262, this removes the dependency on Flask-SQLAlchemy's `db.paginate` extension method. The replacement uses standard SQLAlchemy `select` with `limit`/`offset` and a scalar subquery for the total count, making the pagination logic explicit and portable.

## What changed

Added `api/libs/pagination.py` with:
- `PaginatedResult` — a lightweight dataclass exposing `items`, `total`, `page`, `per_page`, `pages`, `has_next`, plus `__iter__` for direct iteration
- `paginate_query()` — executes count and page queries using plain SQLAlchemy, falling back to `db.session` when no session is passed

All 12 source files that called `db.paginate` have been updated: 5 in dataset_service, 2 in app_service, 2 in annotation_service, 1 each in external_knowledge_service, plugin_migration, conversation controller, workspace controller, datasets_document controller, datasets_segments controller, service_api document controller, the schedule task, and the vector command.

No behavioral changes — the API responses and return types are preserved.

Closes #38262
