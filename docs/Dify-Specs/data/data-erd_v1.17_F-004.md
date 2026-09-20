---
title: Data Model v1.17 F-004 — Agent
id: F-004
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-004 — Agent

> The slice of the data model this feature owns, at field precision. Generated from the ORM.

## Scope

14 entities, 174 columns [D: api/models/].

| Entity | Own / read / write | Source |
| --- | --- | --- |
| `agent_config_drafts` | own | `api/models/agent.py:283` |
| `agent_config_revisions` | own | `api/models/agent.py:363` |
| `agent_config_snapshots` | own | `api/models/agent.py:327` |
| `agent_debug_conversations` | own | `api/models/agent.py:248` |
| `agent_home_snapshots` | own | `api/models/agent.py:218` |
| `agent_skill_binding_snapshots` | own | `api/models/skill.py:158` |
| `agent_skill_bindings` | own | `api/models/skill.py:135` |
| `agent_workspace_bindings` | own | `api/models/agent.py:502` |
| `agent_workspaces` | own | `api/models/agent.py:464` |
| `agents` | own | `api/models/agent.py:140` |
| `skill_draft_files` | own | `api/models/skill.py:88` |
| `skill_versions` | own | `api/models/skill.py:109` |
| `skills` | own | `api/models/skill.py:56` |
| `workflow_agent_node_bindings` | own | `api/models/agent.py:407` |

I: every entity above is owned rather than merely read by this feature — basis: its ORM class is defined in the model module this feature's controllers write through, and no other feature's controllers construct it [D: api/models/].

OPEN: which of these entities are also written by background jobs under `api/tasks/` outside this feature's request path? Ownership at the table level does not settle who writes at runtime.

## Feature ERD

`schema/erd_v1.17_F-004.puml` draws these entities.

## Field definitions

The readable rendering of `schema/schemas.json` `$defs`, which is the single definition of each shape.

### `agent_config_drafts`

ORM class `AgentConfigDraft` [D: api/models/agent.py:283]. Primary key: `id`.

Unique: (`tenant_id`, `agent_id`, `draft_type`, `draft_owner_key`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_config_drafts.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_config_drafts.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_config_drafts.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_config_drafts.tenant_id` | UUID | Yes |  |
| `agent_config_drafts.agent_id` | UUID | Yes |  |
| `agent_config_drafts.draft_type` | String | Yes | enum: draft, debug_build |
| `agent_config_drafts.account_id` | UUID | No |  |
| `agent_config_drafts.draft_owner_key` | String | Yes |  |
| `agent_config_drafts.base_snapshot_id` | UUID | No |  |
| `agent_config_drafts.home_snapshot_id` | UUID | No |  |
| `agent_config_drafts.agent_workspace_binding_id` | UUID | No |  |
| `agent_config_drafts.config_snapshot` | Object | Yes |  |
| `agent_config_drafts.created_by` | UUID | No |  |
| `agent_config_drafts.updated_by` | UUID | No |  |

### `agent_config_revisions`

ORM class `AgentConfigRevision` [D: api/models/agent.py:363]. Primary key: `id`.

Unique: (`agent_id`, `revision`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_config_revisions.id` | UUID | Yes | primary key |
| `agent_config_revisions.tenant_id` | UUID | Yes |  |
| `agent_config_revisions.agent_id` | UUID | Yes |  |
| `agent_config_revisions.previous_snapshot_id` | UUID | No |  |
| `agent_config_revisions.current_snapshot_id` | UUID | Yes |  |
| `agent_config_revisions.revision` | Integer | Yes |  |
| `agent_config_revisions.operation` | String | Yes | enum: create_version, save_current_version, save_new_version, save_new_agent, save_to_roster, restore_version, publish_draft, import_package |
| `agent_config_revisions.summary` | String | No |  |
| `agent_config_revisions.version_note` | String | No |  |
| `agent_config_revisions.created_by` | UUID | No |  |
| `agent_config_revisions.created_at` | DateTime | Yes |  |

### `agent_config_snapshots`

ORM class `AgentConfigSnapshot` [D: api/models/agent.py:327]. Primary key: `id`.

Unique: (`agent_id`, `version`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_config_snapshots.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_config_snapshots.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_config_snapshots.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_config_snapshots.tenant_id` | UUID | Yes |  |
| `agent_config_snapshots.agent_id` | UUID | Yes |  |
| `agent_config_snapshots.version` | Integer | Yes |  |
| `agent_config_snapshots.config_snapshot` | Object | Yes |  |
| `agent_config_snapshots.home_snapshot_id` | UUID | No |  |
| `agent_config_snapshots.summary` | String | No |  |
| `agent_config_snapshots.version_note` | String | No |  |
| `agent_config_snapshots.created_by` | UUID | No |  |

### `agent_debug_conversations`

ORM class `AgentDebugConversation` [D: api/models/agent.py:248]. Primary key: `id`.

Unique: (`tenant_id`, `agent_id`, `account_id`, `draft_type`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_debug_conversations.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_debug_conversations.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_debug_conversations.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_debug_conversations.tenant_id` | UUID | Yes |  |
| `agent_debug_conversations.agent_id` | UUID | Yes |  |
| `agent_debug_conversations.app_id` | UUID | Yes |  |
| `agent_debug_conversations.account_id` | UUID | Yes |  |
| `agent_debug_conversations.draft_type` | String | Yes | enum: draft, debug_build |
| `agent_debug_conversations.conversation_id` | UUID | Yes |  |

### `agent_home_snapshots`

ORM class `AgentHomeSnapshot` [D: api/models/agent.py:218]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_home_snapshots.id` | UUID | Yes | primary key |
| `agent_home_snapshots.tenant_id` | UUID | Yes |  |
| `agent_home_snapshots.agent_id` | UUID | Yes |  |
| `agent_home_snapshots.snapshot_ref` | String | Yes |  |
| `agent_home_snapshots.status` | String | Yes | enum: active, retired |
| `agent_home_snapshots.retired_at` | DateTime | No |  |
| `agent_home_snapshots.created_at` | DateTime | Yes |  |

### `agent_skill_binding_snapshots`

ORM class `AgentSkillBindingSnapshot` [D: api/models/skill.py:158]. Primary key: `id`.

Unique: (`tenant_id`, `agent_id`, `config_snapshot_id`, `skill_id`); (`tenant_id`, `agent_id`, `config_snapshot_id`, `priority`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_skill_binding_snapshots.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_skill_binding_snapshots.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_skill_binding_snapshots.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_skill_binding_snapshots.tenant_id` | UUID | Yes |  |
| `agent_skill_binding_snapshots.agent_id` | UUID | Yes |  |
| `agent_skill_binding_snapshots.config_snapshot_id` | UUID | Yes |  |
| `agent_skill_binding_snapshots.skill_id` | UUID | Yes |  |
| `agent_skill_binding_snapshots.priority` | Integer | Yes |  |
| `agent_skill_binding_snapshots.created_by` | UUID | No |  |

### `agent_skill_bindings`

ORM class `AgentSkillBinding` [D: api/models/skill.py:135]. Primary key: `id`.

Unique: (`tenant_id`, `agent_id`, `skill_id`); (`tenant_id`, `agent_id`, `priority`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_skill_bindings.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_skill_bindings.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_skill_bindings.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_skill_bindings.tenant_id` | UUID | Yes |  |
| `agent_skill_bindings.agent_id` | UUID | Yes |  |
| `agent_skill_bindings.skill_id` | UUID | Yes |  |
| `agent_skill_bindings.priority` | Integer | Yes |  |
| `agent_skill_bindings.created_by` | UUID | No |  |

### `agent_workspace_bindings`

ORM class `AgentWorkspaceBinding` [D: api/models/agent.py:502]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_workspace_bindings.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_workspace_bindings.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_workspace_bindings.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_workspace_bindings.tenant_id` | UUID | Yes |  |
| `agent_workspace_bindings.app_id` | UUID | Yes |  |
| `agent_workspace_bindings.workspace_id` | UUID | Yes |  |
| `agent_workspace_bindings.agent_id` | UUID | Yes |  |
| `agent_workspace_bindings.base_home_snapshot_id` | UUID | No |  |
| `agent_workspace_bindings.agent_config_version_id` | UUID | Yes |  |
| `agent_workspace_bindings.agent_config_version_kind` | String | Yes | enum: snapshot, draft, build_draft |
| `agent_workspace_bindings.backend_binding_ref` | String | Yes |  |
| `agent_workspace_bindings.session_snapshot` | String | No |  |
| `agent_workspace_bindings.status` | String | Yes | enum: active, retired |
| `agent_workspace_bindings.retired_at` | DateTime | No |  |
| `agent_workspace_bindings.pending_form_id` | UUID | No |  |
| `agent_workspace_bindings.pending_tool_call_id` | String | No |  |

### `agent_workspaces`

ORM class `AgentWorkspace` [D: api/models/agent.py:464]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agent_workspaces.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agent_workspaces.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_workspaces.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agent_workspaces.tenant_id` | UUID | Yes |  |
| `agent_workspaces.app_id` | UUID | Yes |  |
| `agent_workspaces.owner_type` | String | Yes | enum: workflow_run, conversation, build_draft |
| `agent_workspaces.owner_id` | UUID | Yes |  |
| `agent_workspaces.owner_scope_key` | String | Yes |  |
| `agent_workspaces.backend_workspace_ref` | String | Yes |  |
| `agent_workspaces.status` | String | Yes | enum: active, retired |
| `agent_workspaces.active_guard` | Integer | No |  |
| `agent_workspaces.retired_at` | DateTime | No |  |

### `agents`

ORM class `Agent` [D: api/models/agent.py:140]. Primary key: `id`.

Unique: (`tenant_id`, `roster_unique_name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `agents.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `agents.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agents.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `agents.tenant_id` | UUID | Yes |  |
| `agents.name` | String | Yes |  |
| `agents.description` | String | Yes |  |
| `agents.role` | String | Yes |  |
| `agents.icon_type` | String | No | enum: image, emoji, link |
| `agents.icon` | String | No |  |
| `agents.icon_background` | String | No |  |
| `agents.agent_kind` | String | Yes | enum: dify_agent |
| `agents.scope` | String | Yes | enum: roster, workflow_only |
| `agents.source` | String | Yes | enum: roster, agent_app, workflow, imported, system |
| `agents.app_id` | UUID | No |  |
| `agents.backing_app_id` | UUID | No |  |
| `agents.workflow_id` | UUID | No |  |
| `agents.workflow_node_id` | String | No |  |
| `agents.active_config_snapshot_id` | UUID | No |  |
| `agents.active_config_has_model` | Boolean | Yes |  |
| `agents.active_config_is_published` | Boolean | Yes |  |
| `agents.status` | String | Yes | enum: active, archived |
| `agents.roster_unique_name` | String | No |  |
| `agents.created_by` | UUID | No |  |
| `agents.updated_by` | UUID | No |  |
| `agents.archived_by` | UUID | No |  |
| `agents.archived_at` | DateTime | No |  |

### `skill_draft_files`

ORM class `SkillDraftFile` [D: api/models/skill.py:88]. Primary key: `id`.

Unique: (`skill_id`, `path`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `skill_draft_files.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `skill_draft_files.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `skill_draft_files.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `skill_draft_files.skill_id` | UUID | Yes |  |
| `skill_draft_files.path` | String | Yes |  |
| `skill_draft_files.kind` | String | Yes | enum: file, directory |
| `skill_draft_files.storage` | String | No | enum: text, tool_file |
| `skill_draft_files.mime_type` | String | No |  |
| `skill_draft_files.content_text` | String | No |  |
| `skill_draft_files.tool_file_id` | UUID | No |  |
| `skill_draft_files.size` | Integer | No |  |
| `skill_draft_files.hash` | String | No |  |

### `skill_versions`

ORM class `SkillVersion` [D: api/models/skill.py:109]. Primary key: `id`.

Unique: (`skill_id`, `version_number`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `skill_versions.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `skill_versions.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `skill_versions.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `skill_versions.skill_id` | UUID | Yes |  |
| `skill_versions.version_number` | Integer | Yes |  |
| `skill_versions.version_name` | String | Yes |  |
| `skill_versions.publish_note` | String | Yes |  |
| `skill_versions.manifest` | Object | Yes |  |
| `skill_versions.archive_tool_file_id` | UUID | Yes |  |
| `skill_versions.hash_code` | String | Yes |  |
| `skill_versions.archive_size` | Integer | Yes |  |
| `skill_versions.published_by` | UUID | No |  |

### `skills`

ORM class `Skill` [D: api/models/skill.py:56]. Primary key: `id`.

Unique: (`tenant_id`, `name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `skills.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `skills.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `skills.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `skills.tenant_id` | UUID | Yes |  |
| `skills.name` | String | Yes |  |
| `skills.display_name` | String | Yes |  |
| `skills.icon` | String | Yes |  |
| `skills.description` | String | Yes |  |
| `skills.name_manually_edited` | Boolean | Yes |  |
| `skills.visibility` | String | Yes |  |
| `skills.latest_published_version_id` | UUID | No |  |
| `skills.created_by` | UUID | No |  |
| `skills.updated_by` | UUID | No |  |

### `workflow_agent_node_bindings`

ORM class `WorkflowAgentNodeBinding` [D: api/models/agent.py:407]. Primary key: `id`.

Unique: (`tenant_id`, `workflow_id`, `workflow_version`, `node_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_agent_node_bindings.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `workflow_agent_node_bindings.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `workflow_agent_node_bindings.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `workflow_agent_node_bindings.tenant_id` | UUID | Yes |  |
| `workflow_agent_node_bindings.app_id` | UUID | Yes |  |
| `workflow_agent_node_bindings.workflow_id` | UUID | Yes |  |
| `workflow_agent_node_bindings.workflow_version` | String | Yes |  |
| `workflow_agent_node_bindings.node_id` | String | Yes |  |
| `workflow_agent_node_bindings.binding_type` | String | Yes | enum: roster_agent, inline_agent |
| `workflow_agent_node_bindings.agent_id` | UUID | No |  |
| `workflow_agent_node_bindings.current_snapshot_id` | UUID | No |  |
| `workflow_agent_node_bindings.node_job_config` | Object | Yes |  |
| `workflow_agent_node_bindings.created_by` | UUID | No |  |
| `workflow_agent_node_bindings.updated_by` | UUID | No |  |

## New and changed entities

This is an as-built record: every entity above already exists in the running schema. Registry rows are in `data-master-erd.md`.

OPEN: which release introduced each entity? Recoverable only from migration filenames, and that dates the migration rather than the feature.

## Migrations

Schema changes for these tables are Alembic revisions in `api/migrations/versions/`, applied in revision order [D: api/migrations/versions/].

OPEN: are the `downgrade()` functions in those revisions exercised anywhere? CI runs a migration job [D: .github/workflows/db-migration-test.yml] but nothing states that it tests the reverse direction.

## Traceability

Domain rules in `ddd/`; stories in `PRDs/prd_v1.17_F-004-*.md`.

OPEN: no column in this repository carries a comment naming the requirement it exists for, so no field-level traceability is recoverable.
