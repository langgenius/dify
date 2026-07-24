from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.publish_visibility import (
    PUBLISH_VISIBLE_APP_BACKED_REVISION_OPERATIONS,
    agent_has_workflow_callable_active_snapshot,
    workflow_callable_active_snapshot_filter,
)
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig
from services.agent.roster_service import AgentRosterService


def _agent_soul() -> AgentSoulConfig:
    return AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        )
    )


def _add_agent(
    session: Session,
    *,
    agent_id: str,
    snapshot_id: str | None,
    name: str,
    source: AgentSource,
    operation: AgentConfigRevisionOperation | None,
    app_id: str | None = None,
    scope: AgentScope = AgentScope.ROSTER,
    status: AgentStatus = AgentStatus.ACTIVE,
    has_model: bool | None = None,
) -> Agent:
    agent = Agent(
        id=agent_id,
        tenant_id="tenant-1",
        name=name,
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=scope,
        source=source,
        app_id=app_id,
        status=status,
        active_config_snapshot_id=snapshot_id,
        active_config_has_model=snapshot_id is not None if has_model is None else has_model,
        # A dirty draft must not hide an already published active snapshot.
        active_config_is_published=False,
    )
    session.add(agent)
    if snapshot_id is None:
        return agent
    session.add(
        AgentConfigSnapshot(
            id=snapshot_id,
            tenant_id="tenant-1",
            agent_id=agent_id,
            version=1,
            config_snapshot=_agent_soul(),
        )
    )
    if operation is not None:
        session.add(
            AgentConfigRevision(
                id=f"revision-{agent_id}",
                tenant_id="tenant-1",
                agent_id=agent_id,
                current_snapshot_id=snapshot_id,
                revision=1,
                operation=operation,
            )
        )
    return agent


def test_publish_visible_operation_contract() -> None:
    assert {
        AgentConfigRevisionOperation.PUBLISH_DRAFT,
        AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
        AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        AgentConfigRevisionOperation.SAVE_NEW_AGENT,
        AgentConfigRevisionOperation.SAVE_TO_ROSTER,
        AgentConfigRevisionOperation.RESTORE_VERSION,
    } == PUBLISH_VISIBLE_APP_BACKED_REVISION_OPERATIONS


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, AgentConfigSnapshot, AgentConfigRevision, WorkflowAgentNodeBinding)],
    indirect=True,
)
def test_workflow_callable_filter_distinguishes_never_published_from_dirty_drafts(
    sqlite_session: Session,
) -> None:
    imported_draft = _add_agent(
        sqlite_session,
        agent_id="agent-imported-draft",
        snapshot_id="snapshot-imported-draft",
        name="Imported draft",
        source=AgentSource.IMPORTED,
        operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
        app_id="app-imported-draft",
    )
    app_draft = _add_agent(
        sqlite_session,
        agent_id="agent-app-draft",
        snapshot_id="snapshot-app-draft",
        name="App draft",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
    )
    published_with_dirty_draft = _add_agent(
        sqlite_session,
        agent_id="agent-published-dirty",
        snapshot_id="snapshot-published-dirty",
        name="Published with dirty draft",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    saved_to_current_version = _add_agent(
        sqlite_session,
        agent_id="agent-saved-current",
        snapshot_id="snapshot-saved-current",
        name="Saved to current version",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
    )
    saved_as_new_agent = _add_agent(
        sqlite_session,
        agent_id="agent-saved-new",
        snapshot_id="snapshot-saved-new",
        name="Saved as new agent",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.SAVE_NEW_AGENT,
    )
    saved_as_new_version = _add_agent(
        sqlite_session,
        agent_id="agent-saved-new-version",
        snapshot_id="snapshot-saved-new-version",
        name="Saved as new version",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
    )
    saved_to_roster = _add_agent(
        sqlite_session,
        agent_id="agent-saved-to-roster",
        snapshot_id="snapshot-saved-to-roster",
        name="Saved to roster",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.SAVE_TO_ROSTER,
    )
    restored_version = _add_agent(
        sqlite_session,
        agent_id="agent-restored-version",
        snapshot_id="snapshot-restored-version",
        name="Restored version",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.RESTORE_VERSION,
    )
    direct_roster_agent = _add_agent(
        sqlite_session,
        agent_id="agent-direct-roster",
        snapshot_id="snapshot-direct-roster",
        name="Direct roster",
        source=AgentSource.ROSTER,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
    )
    direct_imported_roster_agent = _add_agent(
        sqlite_session,
        agent_id="agent-direct-imported",
        snapshot_id="snapshot-direct-imported",
        name="Direct imported roster",
        source=AgentSource.IMPORTED,
        operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
    )
    no_snapshot = _add_agent(
        sqlite_session,
        agent_id="agent-no-snapshot",
        snapshot_id=None,
        name="No snapshot",
        source=AgentSource.ROSTER,
        operation=None,
    )
    published_without_model = _add_agent(
        sqlite_session,
        agent_id="agent-published-without-model",
        snapshot_id="snapshot-published-without-model",
        name="Published without model",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        has_model=False,
    )
    archived_agent = _add_agent(
        sqlite_session,
        agent_id="agent-archived",
        snapshot_id="snapshot-archived",
        name="Archived",
        source=AgentSource.ROSTER,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
        status=AgentStatus.ARCHIVED,
    )
    workflow_only_agent = _add_agent(
        sqlite_session,
        agent_id="agent-workflow-only",
        snapshot_id="snapshot-workflow-only",
        name="Workflow only",
        source=AgentSource.WORKFLOW,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
        scope=AgentScope.WORKFLOW_ONLY,
    )
    stale_published_snapshot = _add_agent(
        sqlite_session,
        agent_id="agent-stale-published-snapshot",
        snapshot_id="snapshot-current-unpublished",
        name="Stale published snapshot",
        source=AgentSource.AGENT_APP,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
    )
    cross_owner_revision = _add_agent(
        sqlite_session,
        agent_id="agent-cross-owner-revision",
        snapshot_id="snapshot-cross-owner-revision",
        name="Cross owner revision",
        source=AgentSource.AGENT_APP,
        operation=None,
    )
    sqlite_session.add(
        AgentConfigSnapshot(
            id="snapshot-old-published",
            tenant_id="tenant-1",
            agent_id=stale_published_snapshot.id,
            version=2,
            config_snapshot=_agent_soul(),
        )
    )
    sqlite_session.add(
        AgentConfigRevision(
            id="revision-old-published",
            tenant_id="tenant-1",
            agent_id=stale_published_snapshot.id,
            current_snapshot_id="snapshot-old-published",
            revision=2,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    sqlite_session.add(
        AgentConfigRevision(
            id="revision-published-dirty-2",
            tenant_id="tenant-1",
            agent_id=published_with_dirty_draft.id,
            current_snapshot_id=published_with_dirty_draft.active_config_snapshot_id,
            revision=2,
            operation=AgentConfigRevisionOperation.RESTORE_VERSION,
        )
    )
    sqlite_session.add(
        AgentConfigRevision(
            id="revision-cross-owner",
            tenant_id="tenant-other",
            agent_id="agent-other",
            current_snapshot_id=cross_owner_revision.active_config_snapshot_id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    imported_draft.updated_at = datetime(2031, 7, 24, 12, 0, 0)
    published_with_dirty_draft.updated_at = datetime(2030, 7, 24, 11, 0, 0)
    sqlite_session.commit()

    callable_agent_ids = set(
        sqlite_session.scalars(select(Agent.id).where(workflow_callable_active_snapshot_filter())).all()
    )

    assert callable_agent_ids == {
        published_with_dirty_draft.id,
        saved_to_current_version.id,
        saved_as_new_agent.id,
        saved_as_new_version.id,
        saved_to_roster.id,
        restored_version.id,
        direct_roster_agent.id,
        direct_imported_roster_agent.id,
        published_without_model.id,
        archived_agent.id,
        workflow_only_agent.id,
    }
    assert agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=published_with_dirty_draft)
    assert agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=direct_roster_agent)
    assert agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=direct_imported_roster_agent)
    assert not agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=imported_draft)
    assert not agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=app_draft)
    assert not agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=no_snapshot)
    assert not agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=stale_published_snapshot)
    assert not agent_has_workflow_callable_active_snapshot(session=sqlite_session, agent=cross_owner_revision)

    invite_options = AgentRosterService(sqlite_session).list_invite_options(
        tenant_id="tenant-1",
        page=1,
        limit=20,
    )

    expected_invite_ids = callable_agent_ids - {
        published_without_model.id,
        archived_agent.id,
        workflow_only_agent.id,
    }
    assert invite_options["total"] == len(expected_invite_ids)
    assert {item["id"] for item in invite_options["data"]} == expected_invite_ids

    first_page = AgentRosterService(sqlite_session).list_invite_options(
        tenant_id="tenant-1",
        page=1,
        limit=1,
    )
    assert first_page["total"] == len(expected_invite_ids)
    assert first_page["has_more"] is True
    assert [item["id"] for item in first_page["data"]] == [published_with_dirty_draft.id]

    unpublished_keyword = AgentRosterService(sqlite_session).list_invite_options(
        tenant_id="tenant-1",
        page=1,
        limit=20,
        keyword="Imported draft",
    )
    assert unpublished_keyword["total"] == 0
    assert unpublished_keyword["data"] == []
