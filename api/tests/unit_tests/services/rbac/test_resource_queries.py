"""Authorization references use the composed repositories and detached snapshots."""

import pytest
from sqlalchemy.orm import Session

from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.model import AppMode
from services.entities.app_entities import AppAgentBinding
from services.rbac.resource_queries import ResourceQueryService
from tests.unit_tests.model_factories import make_app, make_dataset, make_document
from tests.unit_tests.rbac_fakes import RBACDomain


@pytest.fixture
def queries(rbac_domain: RBACDomain) -> ResourceQueryService:
    return rbac_domain.rbac.queries


TENANT_ID = "tenant-1"
OTHER_TENANT_ID = "tenant-2"


def _agent(*, agent_id: str, app_id: str, status: AgentStatus = AgentStatus.ACTIVE) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id=TENANT_ID,
        name=agent_id,
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id=app_id,
        status=status,
        created_by="account-1",
        updated_by="account-1",
    )


class TestGetAppAgentBinding:
    def test_does_not_resolve_an_agent_from_another_tenant(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        agent = _agent(agent_id="agent-1", app_id="app-1")
        agent.tenant_id = OTHER_TENANT_ID
        sqlite_session.add_all([make_app(app_id="app-1", mode=AppMode.AGENT), agent])
        sqlite_session.commit()

        assert queries.get_app_agent_binding(TENANT_ID, "app-1") is None

    def test_returns_workflow_binding_snapshot_after_session_closes(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        agent = _agent(agent_id="agent-1", app_id="workflow-app")
        agent.scope = AgentScope.WORKFLOW_ONLY
        agent.source = AgentSource.WORKFLOW
        agent.backing_app_id = "app-1"
        sqlite_session.add_all([make_app(app_id="app-1", mode=AppMode.AGENT), agent])
        sqlite_session.commit()

        assert queries.get_app_agent_binding(TENANT_ID, "app-1") == AppAgentBinding("agent-1", workflow_only=True)

    def test_returns_none_when_the_app_belongs_to_another_tenant(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add(make_app(app_id="app-1", tenant_id=OTHER_TENANT_ID, mode=AppMode.AGENT))
        sqlite_session.commit()

        assert queries.get_app_agent_binding(TENANT_ID, "app-1") is None

    def test_returns_none_for_an_app_that_is_not_an_agent_app(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add_all([make_app(app_id="app-1"), _agent(agent_id="agent-1", app_id="app-1")])
        sqlite_session.commit()

        assert queries.get_app_agent_binding(TENANT_ID, "app-1") is None

    def test_returns_the_bound_agent_including_archived_ones(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add_all(
            [
                make_app(app_id="app-1", mode=AppMode.AGENT),
                _agent(agent_id="agent-1", app_id="app-1", status=AgentStatus.ARCHIVED),
            ]
        )
        sqlite_session.commit()

        binding = queries.get_app_agent_binding(TENANT_ID, "app-1")

        assert binding is not None
        assert binding == AppAgentBinding(id="agent-1", workflow_only=False)


class TestGetAppMaintainer:
    def test_returns_the_maintainer_of_an_app_in_the_tenant(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add(make_app(app_id="app-1", maintainer="account-1"))
        sqlite_session.commit()

        assert queries.get_app_maintainer(TENANT_ID, "app-1") == "account-1"

    def test_does_not_leak_across_tenants(self, sqlite_session: Session, queries: ResourceQueryService) -> None:
        sqlite_session.add(make_app(app_id="app-1", tenant_id=OTHER_TENANT_ID, maintainer="account-1"))
        sqlite_session.commit()

        assert queries.get_app_maintainer(TENANT_ID, "app-1") is None


class TestGetDatasetMaintainer:
    def test_returns_the_maintainer_of_a_dataset_in_the_tenant(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add(make_dataset(dataset_id="dataset-1", maintainer="account-2"))
        sqlite_session.commit()

        assert queries.get_dataset_maintainer(TENANT_ID, "dataset-1") == "account-2"

    def test_does_not_leak_across_tenants(self, sqlite_session: Session, queries: ResourceQueryService) -> None:
        sqlite_session.add(make_dataset(dataset_id="dataset-1", tenant_id=OTHER_TENANT_ID, maintainer="account-2"))
        sqlite_session.commit()

        assert queries.get_dataset_maintainer(TENANT_ID, "dataset-1") is None


class TestGetDatasetIdByPipeline:
    def test_returns_the_dataset_id_for_the_pipeline(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add(make_dataset(dataset_id="dataset-1", pipeline_id="pipeline-1"))
        sqlite_session.commit()

        assert queries.get_dataset_id_by_pipeline(TENANT_ID, "pipeline-1") == "dataset-1"

    def test_returns_none_when_no_dataset_in_the_tenant_uses_the_pipeline(
        self, sqlite_session: Session, queries: ResourceQueryService
    ) -> None:
        sqlite_session.add(make_dataset(dataset_id="dataset-1", tenant_id=OTHER_TENANT_ID, pipeline_id="pipeline-1"))
        sqlite_session.commit()

        assert queries.get_dataset_id_by_pipeline(TENANT_ID, "pipeline-1") is None


class TestGetDatasetIdByDocument:
    @pytest.mark.parametrize(
        ("dataset_tenant", "document_tenant", "expected"),
        [
            (TENANT_ID, TENANT_ID, "dataset-1"),
            (OTHER_TENANT_ID, OTHER_TENANT_ID, None),
            (OTHER_TENANT_ID, TENANT_ID, None),
            (TENANT_ID, OTHER_TENANT_ID, None),
        ],
    )
    def test_scopes_both_dataset_and_document(
        self,
        sqlite_session: Session,
        queries: ResourceQueryService,
        dataset_tenant: str,
        document_tenant: str,
        expected: str | None,
    ) -> None:
        sqlite_session.add_all(
            [
                make_dataset(dataset_id="dataset-1", tenant_id=dataset_tenant),
                make_document(document_id="doc-1", dataset_id="dataset-1", tenant_id=document_tenant),
            ]
        )
        sqlite_session.commit()

        assert queries.get_dataset_id_by_document(TENANT_ID, "doc-1") == expected

    def test_missing_document(self, queries: ResourceQueryService) -> None:
        assert queries.get_dataset_id_by_document(TENANT_ID, "missing") is None
