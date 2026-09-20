---
title: Data Model v1.17 F-006 — Published App Surfaces
id: F-006
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-006 — Published App Surfaces

> The slice of the data model this feature owns, at field precision. Generated from the ORM.

## Scope

4 entities, 30 columns [D: api/models/].

| Entity | Own / read / write | Source |
| --- | --- | --- |
| `end_users` | own | `api/models/model.py:2089` |
| `installed_apps` | own | `api/models/model.py:974` |
| `pinned_conversations` | own | `api/models/web.py:42` |
| `saved_messages` | own | `api/models/web.py:14` |

I: every entity above is owned rather than merely read by this feature — basis: its ORM class is defined in the model module this feature's controllers write through, and no other feature's controllers construct it [D: api/models/].

OPEN: which of these entities are also written by background jobs under `api/tasks/` outside this feature's request path? Ownership at the table level does not settle who writes at runtime.

## Feature ERD

`schema/erd_v1.17_F-006.puml` draws these entities.

## Field definitions

The readable rendering of `schema/schemas.json` `$defs`, which is the single definition of each shape.

### `end_users`

ORM class `EndUser` [D: api/models/model.py:2089]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `end_users.id` | UUID | Yes | primary key |
| `end_users.tenant_id` | UUID | Yes |  |
| `end_users.app_id` | UUID | No |  |
| `end_users.type` | String | Yes | enum: app-deploy, browser, mcp, openapi, service-api, trigger |
| `end_users.external_user_id` | String | No |  |
| `end_users.name` | String | No |  |
| `end_users._is_anonymous` | Boolean | Yes |  |
| `end_users.session_id` | String | Yes |  |
| `end_users.created_at` | DateTime | Yes |  |
| `end_users.updated_at` | DateTime | Yes |  |

### `installed_apps`

ORM class `InstalledApp` [D: api/models/model.py:974]. Primary key: `id`.

Unique: (`tenant_id`, `app_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `installed_apps.id` | UUID | Yes | primary key |
| `installed_apps.tenant_id` | UUID | Yes |  |
| `installed_apps.app_id` | UUID | Yes |  |
| `installed_apps.app_owner_tenant_id` | UUID | Yes |  |
| `installed_apps.position` | Integer | Yes |  |
| `installed_apps.is_pinned` | Boolean | Yes |  |
| `installed_apps.last_used_at` | DateTime | No |  |
| `installed_apps.created_at` | DateTime | Yes |  |

### `pinned_conversations`

ORM class `PinnedConversation` [D: api/models/web.py:42]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pinned_conversations.id` | UUID | Yes | primary key |
| `pinned_conversations.app_id` | UUID | Yes |  |
| `pinned_conversations.conversation_id` | UUID | Yes |  |
| `pinned_conversations.created_by_role` | String | Yes | enum: account, end_user |
| `pinned_conversations.created_by` | UUID | Yes |  |
| `pinned_conversations.created_at` | DateTime | Yes |  |

### `saved_messages`

ORM class `SavedMessage` [D: api/models/web.py:14]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `saved_messages.id` | UUID | Yes | primary key |
| `saved_messages.app_id` | UUID | Yes |  |
| `saved_messages.message_id` | UUID | Yes |  |
| `saved_messages.created_by_role` | String | Yes | enum: account, end_user |
| `saved_messages.created_by` | UUID | Yes |  |
| `saved_messages.created_at` | DateTime | Yes |  |

## New and changed entities

This is an as-built record: every entity above already exists in the running schema. Registry rows are in `data-master-erd.md`.

OPEN: which release introduced each entity? Recoverable only from migration filenames, and that dates the migration rather than the feature.

## Migrations

Schema changes for these tables are Alembic revisions in `api/migrations/versions/`, applied in revision order [D: api/migrations/versions/].

OPEN: are the `downgrade()` functions in those revisions exercised anywhere? CI runs a migration job [D: .github/workflows/db-migration-test.yml] but nothing states that it tests the reverse direction.

## Traceability

Domain rules in `ddd/`; stories in `PRDs/prd_v1.17_F-006-*.md`.

OPEN: no column in this repository carries a comment naming the requirement it exists for, so no field-level traceability is recoverable.
