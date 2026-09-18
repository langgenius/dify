"""RBACResourceService reads through the session its caller passes in (#37403)."""

from sqlalchemy.orm import Session

from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.dataset import Dataset
from models.model import App, AppMode
from services.rbac_resource_service import RBACResourceService

TENANT_ID = "tenant-1"
OTHER_TENANT_ID = "tenant-2"


def _app(
    *,
    app_id: str,
    tenant_id: str = TENANT_ID,
    mode: AppMode = AppMode.CHAT,
    maintainer: str | None = None,
) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=f"App {app_id}",
        description="",
        mode=mode,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
        maintainer=maintainer,
    )


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


def _dataset(
    *,
    dataset_id: str,
    tenant_id: str = TENANT_ID,
    maintainer: str | None = None,
    pipeline_id: str | None = None,
) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"Dataset {dataset_id}",
        created_by="account-1",
        maintainer=maintainer,
        pipeline_id=pipeline_id,
    )


class TestGetAppAgentBinding:
    def test_returns_none_when_the_app_belongs_to_another_tenant(self, sqlite_session: Session) -> None:
        sqlite_session.add(_app(app_id="app-1", tenant_id=OTHER_TENANT_ID, mode=AppMode.AGENT))
        sqlite_session.flush()

        assert RBACResourceService.get_app_agent_binding(sqlite_session, TENANT_ID, "app-1") is None

    def test_returns_none_for_an_app_that_is_not_an_agent_app(self, sqlite_session: Session) -> None:
        sqlite_session.add_all([_app(app_id="app-1"), _agent(agent_id="agent-1", app_id="app-1")])
        sqlite_session.flush()

        assert RBACResourceService.get_app_agent_binding(sqlite_session, TENANT_ID, "app-1") is None

    def test_returns_the_bound_agent_including_archived_ones(self, sqlite_session: Session) -> None:
        sqlite_session.add_all(
            [
                _app(app_id="app-1", mode=AppMode.AGENT),
                _agent(agent_id="agent-1", app_id="app-1", status=AgentStatus.ARCHIVED),
            ]
        )
        sqlite_session.flush()

        binding = RBACResourceService.get_app_agent_binding(sqlite_session, TENANT_ID, "app-1")

        assert binding is not None
        assert binding.id == "agent-1"


class TestGetAppMaintainer:
    def test_returns_the_maintainer_of_an_app_in_the_tenant(self, sqlite_session: Session) -> None:
        sqlite_session.add(_app(app_id="app-1", maintainer="account-1"))
        sqlite_session.flush()

        assert RBACResourceService.get_app_maintainer(sqlite_session, TENANT_ID, "app-1") == "account-1"

    def test_does_not_leak_across_tenants(self, sqlite_session: Session) -> None:
        sqlite_session.add(_app(app_id="app-1", tenant_id=OTHER_TENANT_ID, maintainer="account-1"))
        sqlite_session.flush()

        assert RBACResourceService.get_app_maintainer(sqlite_session, TENANT_ID, "app-1") is None


class TestGetDatasetMaintainer:
    def test_returns_the_maintainer_of_a_dataset_in_the_tenant(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(dataset_id="dataset-1", maintainer="account-2"))
        sqlite_session.flush()

        assert RBACResourceService.get_dataset_maintainer(sqlite_session, TENANT_ID, "dataset-1") == "account-2"

    def test_does_not_leak_across_tenants(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(dataset_id="dataset-1", tenant_id=OTHER_TENANT_ID, maintainer="account-2"))
        sqlite_session.flush()

        assert RBACResourceService.get_dataset_maintainer(sqlite_session, TENANT_ID, "dataset-1") is None


class TestGetDatasetIdByPipeline:
    def test_returns_the_dataset_id_for_the_pipeline(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(dataset_id="dataset-1", pipeline_id="pipeline-1"))
        sqlite_session.flush()

        assert RBACResourceService.get_dataset_id_by_pipeline(sqlite_session, TENANT_ID, "pipeline-1") == "dataset-1"

    def test_returns_none_when_no_dataset_in_the_tenant_uses_the_pipeline(self, sqlite_session: Session) -> None:
        sqlite_session.add(_dataset(dataset_id="dataset-1", tenant_id=OTHER_TENANT_ID, pipeline_id="pipeline-1"))
        sqlite_session.flush()

        assert RBACResourceService.get_dataset_id_by_pipeline(sqlite_session, TENANT_ID, "pipeline-1") is None
