"""Exercise Agent version history and restore through real Console HTTP and SQLite."""

from dataclasses import replace
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import select

from enums import CloudPlan, DeploymentEdition
from extensions.application_services.agent import _can_restore_version
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from repositories.agent_version_repository import SQLAlchemyAgentVersionRepository
from services.agent.version_service import AgentVersionService
from services.agent.version_store import AgentVersionPlanRequiredError
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)


def _seed_history(harness: Harness, agent_id: str) -> tuple[str, str, str]:
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        snapshots = [
            AgentConfigSnapshot(
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                version=number,
                config_snapshot=AgentSoulConfig(),
                version_note=f"version {number}",
            )
            for number in (1, 2, 3)
        ]
        session.add_all(snapshots)
        session.flush()
        for revision, snapshot, operation in zip(
            (1, 2, 3),
            snapshots,
            (
                AgentConfigRevisionOperation.PUBLISH_DRAFT,
                AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
                AgentConfigRevisionOperation.SAVE_NEW_VERSION,
            ),
            strict=True,
        ):
            session.add(
                AgentConfigRevision(
                    tenant_id=harness.tenant_id,
                    agent_id=agent_id,
                    current_snapshot_id=snapshot.id,
                    revision=revision,
                    operation=operation,
                    created_by=harness.account_id,
                )
            )
        agent.active_config_snapshot_id = snapshots[2].id
        agent.active_config_is_published = True
        return snapshots[0].id, snapshots[1].id, snapshots[2].id


def test_list_and_detail_show_only_visible_versions_with_stable_numbering(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, hidden, last = _seed_history(harness, agent_id)
    response = harness.client.get(f"/console/api/agent/{agent_id}/versions", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    versions = response.get_json()["data"]
    assert [(item["id"], item["version"], item["snapshot_version"]) for item in versions] == [
        (last, 2, 3),
        (first, 1, 1),
    ]
    detail = harness.client.get(f"/console/api/agent/{agent_id}/versions/{first}", headers=harness.headers)
    assert detail.status_code == HTTPStatus.OK
    assert detail.get_json()["version"] == 1
    assert AgentSoulConfig.model_validate(detail.get_json()["config_snapshot"]) == AgentSoulConfig()
    assert detail.get_json()["revisions"][0]["operation"] == "publish_draft"
    hidden_response = harness.client.get(f"/console/api/agent/{agent_id}/versions/{hidden}", headers=harness.headers)
    assert hidden_response.status_code == HTTPStatus.NOT_FOUND


def test_restore_creates_then_updates_shared_draft_without_switching_active_snapshot(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, hidden, last = _seed_history(harness, agent_id)
    for version_id, published in ((first, False), (last, True)):
        response = harness.client.post(
            f"/console/api/agent/{agent_id}/versions/{version_id}/restore", headers=harness.headers
        )
        assert response.status_code == HTTPStatus.OK
        body = response.get_json()
        assert body["result"] == "success"
        assert body["active_config_snapshot_id"] == last
        assert body["restored_version_id"] == version_id
        with harness.sessions() as session:
            agent = session.get(Agent, agent_id)
            draft = session.get(AgentConfigDraft, body["draft_config_id"])
            assert agent is not None
            assert draft is not None
            assert agent.active_config_snapshot_id == last
            assert agent.active_config_is_published is published
            assert draft.draft_type == AgentConfigDraftType.DRAFT
            assert draft.account_id is None
            assert draft.base_snapshot_id == version_id
    rejected = harness.client.post(f"/console/api/agent/{agent_id}/versions/{hidden}/restore", headers=harness.headers)
    assert rejected.status_code == HTTPStatus.NOT_FOUND
    with harness.sessions() as session:
        drafts = session.scalars(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)).all()
        assert len(drafts) == 1
        assert drafts[0].base_snapshot_id == last


def test_foreign_agent_and_version_cannot_be_read_or_restored(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    other_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    first, _, _ = _seed_history(harness, agent_id)
    assert harness.client.get(f"/console/api/agent/{other_id}/versions", headers=harness.headers).status_code == 404
    for method, path in (
        ("get", f"/console/api/agent/{other_id}/versions/{first}"),
        ("post", f"/console/api/agent/{other_id}/versions/{first}/restore"),
        ("get", f"/console/api/agent/{agent_id}/versions/{uuid4()}"),
        ("post", f"/console/api/agent/{agent_id}/versions/{uuid4()}/restore"),
    ):
        response = harness.client.open(path, method=method.upper(), headers=harness.headers)
        assert response.status_code == HTTPStatus.NOT_FOUND
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id).where(AgentConfigDraft.agent_id == other_id)) is None


def test_version_from_another_agent_in_the_same_workspace_is_not_accessible(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, _, _ = _seed_history(harness, agent_id)
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        agent.name = "First Agent"
    other_id, _ = harness.create_agent()
    listing = harness.client.get(f"/console/api/agent/{other_id}/versions", headers=harness.headers)
    assert listing.status_code == HTTPStatus.OK
    assert listing.get_json() == {"data": []}
    detail = harness.client.get(f"/console/api/agent/{other_id}/versions/{first}", headers=harness.headers)
    restore = harness.client.post(f"/console/api/agent/{other_id}/versions/{first}/restore", headers=harness.headers)
    assert detail.status_code == HTTPStatus.NOT_FOUND
    assert restore.status_code == HTTPStatus.NOT_FOUND


def test_member_can_read_versions_but_cannot_restore(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, _, _ = _seed_history(harness, agent_id)
    with harness.sessions.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == harness.tenant_id, TenantAccountJoin.account_id == harness.account_id
            )
        )
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    listing = harness.client.get(f"/console/api/agent/{agent_id}/versions", headers=harness.headers)
    restore = harness.client.post(f"/console/api/agent/{agent_id}/versions/{first}/restore", headers=harness.headers)
    assert listing.status_code == HTTPStatus.OK
    assert restore.status_code == HTTPStatus.FORBIDDEN
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id).where(AgentConfigDraft.agent_id == agent_id)) is None


def test_plan_rejection_precedes_database_mutation_but_does_not_block_reads(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, _, _ = _seed_history(harness, agent_id)
    service = AgentVersionService(
        store=SQLAlchemyAgentVersionRepository(session_factory=harness.sessions), restore_allowed=lambda _tenant: False
    )
    context = RequestContext(
        account_id=harness.account_id, active_workspace_id=harness.tenant_id, request_id="test", trace_id=None
    )
    assert len(service.list_versions(context, agent_id)) == 2
    assert service.get_version(context, agent_id, first).id == first
    with pytest.raises(AgentVersionPlanRequiredError):
        service.restore_version(context, agent_id, first)
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id).where(AgentConfigDraft.agent_id == agent_id)) is None


def test_restore_plan_rejection_returns_forbidden_without_changing_the_draft(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, _, _ = _seed_history(harness, agent_id)
    app = harness.client.application
    with app.app_context():
        services = application_services()
        app.extensions["application_services"] = replace(
            services,
            agent_versions=AgentVersionService(
                store=SQLAlchemyAgentVersionRepository(session_factory=harness.sessions),
                restore_allowed=lambda _tenant: False,
            ),
        )
    response = harness.client.post(f"/console/api/agent/{agent_id}/versions/{first}/restore", headers=harness.headers)
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["message"] == "This feature requires a paid plan."
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id).where(AgentConfigDraft.agent_id == agent_id)) is None


def test_archived_roster_agent_retains_version_history_and_restore(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    first, _, last = _seed_history(harness, agent_id)
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        agent.status = AgentStatus.ARCHIVED

    listing = harness.client.get(f"/console/api/agent/{agent_id}/versions", headers=harness.headers)
    assert listing.status_code == HTTPStatus.OK
    assert [item["id"] for item in listing.get_json()["data"]] == [last, first]
    detail = harness.client.get(f"/console/api/agent/{agent_id}/versions/{first}", headers=harness.headers)
    assert detail.status_code == HTTPStatus.OK
    assert detail.get_json()["id"] == first
    restored = harness.client.post(f"/console/api/agent/{agent_id}/versions/{first}/restore", headers=harness.headers)
    assert restored.status_code == HTTPStatus.OK
    with harness.sessions() as session:
        agent = session.get(Agent, agent_id)
        draft = session.get(AgentConfigDraft, restored.get_json()["draft_config_id"])
        assert agent is not None
        assert draft is not None
        assert agent.status == AgentStatus.ARCHIVED
        assert agent.active_config_snapshot_id == last
        assert draft.base_snapshot_id == first


@pytest.mark.parametrize(
    ("edition", "plan", "allowed", "reads_billing"),
    [
        (DeploymentEdition.CLOUD, CloudPlan.SANDBOX, False, True),
        (DeploymentEdition.CLOUD, CloudPlan.PROFESSIONAL, True, True),
        (DeploymentEdition.CLOUD, CloudPlan.TEAM, True, True),
        (DeploymentEdition.COMMUNITY, CloudPlan.SANDBOX, True, False),
        (DeploymentEdition.ENTERPRISE, CloudPlan.SANDBOX, True, False),
    ],
)
def test_restore_plan_policy(edition: DeploymentEdition, plan: CloudPlan, allowed: bool, reads_billing: bool) -> None:
    reads: list[str] = []

    def get_plan(tenant_id: str) -> CloudPlan:
        reads.append(tenant_id)
        return plan

    assert _can_restore_version("tenant", edition=edition, get_plan=get_plan) is allowed
    assert reads == (["tenant"] if reads_billing else [])
