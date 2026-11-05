"""HTTP resource resolution uses composed queries and request-local snapshots."""

import pytest
from flask import Flask
from sqlalchemy import Engine, event, text
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.common.errors import InvalidArgumentError
from controllers.common.rbac import locators
from controllers.common.rbac.checks import RBACCheck, enforce_rbac_checks
from core.rbac import RBACPermission, RBACResourceScope
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import AppMode
from tests.helpers.unit.model_factories import make_app, make_dataset, make_document
from tests.helpers.unit.rbac_fakes import RBACDomain


@pytest.fixture(autouse=True)
def services(monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain) -> None:
    monkeypatch.setattr(locators, "application_services", lambda: rbac_domain)


@pytest.mark.parametrize(
    "locator",
    [
        locators.PlainApp(),
        locators.AgentBehindApp(),
        locators.AgentId(),
        locators.DatasetId(),
        locators.DatasetByDocument(),
        locators.DatasetByPipeline(),
    ],
)
def test_missing_resource_parameter_is_an_explicit_input_error(locator: locators.ResourceLocator) -> None:
    with pytest.raises(InvalidArgumentError, match="Missing .* in request path") as raised:
        locator.locate("workspace", {})
    assert raised.value.code == 400
    assert raised.value.error_code == "invalid_param"


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_agent_app_resolution_preserves_scope_and_archived_bindings(
    app: Flask, rbac_domain: RBACDomain, scope: AgentScope, status: AgentStatus
) -> None:
    with rbac_domain.sessions.begin() as session:
        session.add(make_app(app_id="app", tenant_id="workspace", mode=AppMode.AGENT))
        session.add(
            Agent(
                id="agent",
                tenant_id="workspace",
                name="Agent",
                scope=scope,
                source=AgentSource.AGENT_APP if scope == AgentScope.ROSTER else AgentSource.WORKFLOW,
                app_id="app" if scope == AgentScope.ROSTER else "workflow",
                backing_app_id="app" if scope == AgentScope.WORKFLOW_ONLY else None,
                status=status,
            )
        )

    with app.test_request_context():
        assert locators.PlainApp().locate("workspace", {"app_id": "app"}) is None
        assert locators.AgentBehindApp().locate("workspace", {"app_id": "app"}) == (
            locators.ResourceIdentity(RBACResourceScope.AGENT, "agent") if scope == AgentScope.ROSTER else None
        )


def test_binding_cache_is_tenant_scoped_and_expires_with_request(
    app: Flask, rbac_domain: RBACDomain, sqlite_engine: Engine
) -> None:
    with rbac_domain.sessions.begin() as session:
        session.add(make_app(app_id="app", tenant_id="workspace", mode=AppMode.AGENT))
    queries: list[str] = []

    def record_query(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _executemany: bool
    ) -> None:
        queries.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_query)
    try:
        with app.app_context(), app.test_request_context():
            assert locators.agent_binding("workspace", "app") is None
            reads = len(queries)
            assert reads > 0
            assert locators.agent_binding("workspace", "app") is None
            assert len(queries) == reads
            assert locators.agent_binding("other-workspace", "app") is None
            assert len(queries) > reads

        with rbac_domain.sessions.begin() as session:
            session.add(
                Agent(
                    id="agent",
                    tenant_id="workspace",
                    name="Agent",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.AGENT_APP,
                    app_id="app",
                    status=AgentStatus.ACTIVE,
                )
            )
        with app.app_context(), app.test_request_context():
            binding = locators.agent_binding("workspace", "app")
            assert binding is not None
            assert binding.id == "agent"
            assert locators.agent_binding("other-workspace", "app") is None
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_query)


@pytest.mark.parametrize("normal", [True, False])
def test_app_owner_resolution_preserves_normal_app_requirement(
    app: Flask, rbac_domain: RBACDomain, normal: bool
) -> None:
    with rbac_domain.sessions.begin() as session:
        session.add(make_app(app_id="app", tenant_id="workspace", maintainer="owner"))
        if not normal:
            session.flush()
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = 'app'"))
    with app.test_request_context():
        locator = locators.PlainApp()
        identity = locators.ResourceIdentity(RBACResourceScope.APP, "app")
        assert locator.owner_id("workspace", identity) == ("owner" if normal else None)
        assert locator.owner_id("other-workspace", identity) is None


@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_agent_owner_resolution_is_workspace_scoped(rbac_domain: RBACDomain, status: AgentStatus) -> None:
    with rbac_domain.sessions.begin() as session:
        session.add(
            Agent(
                id="agent",
                tenant_id="workspace",
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                created_by="owner",
                status=status,
            )
        )
    locator = locators.AgentId()
    identity = locators.ResourceIdentity(RBACResourceScope.AGENT, "agent")
    assert locator.owner_id("workspace", identity) == ("owner" if status == AgentStatus.ACTIVE else None)
    assert locator.owner_id("other-workspace", identity) is None
    assert locator.owner_id("workspace", locators.ResourceIdentity(RBACResourceScope.AGENT, "missing")) is None


@pytest.mark.parametrize(
    ("workspace_id", "account_id", "is_owner"),
    [("workspace", "owner", True), ("workspace", "other", False), ("other-workspace", "owner", False)],
)
def test_agent_creator_bypasses_rbac_only_in_own_workspace(
    app: Flask,
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str,
    account_id: str,
    is_owner: bool,
) -> None:
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    rbac_domain.transport.response = {"allowed": False}
    with rbac_domain.sessions.begin() as session:
        session.add(
            Agent(
                id="agent",
                tenant_id="workspace",
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                created_by="owner",
            )
        )
    with app.test_request_context():
        if is_owner:
            enforce_rbac_checks(
                tenant_id=workspace_id,
                account_id=account_id,
                checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, locators.AgentId())],
                path_args={"agent_id": "agent"},
            )
            assert not rbac_domain.transport.requests
        else:
            with pytest.raises(Forbidden):
                enforce_rbac_checks(
                    tenant_id=workspace_id,
                    account_id=account_id,
                    checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, locators.AgentId())],
                    path_args={"agent_id": "agent"},
                )
            assert rbac_domain.transport.only_request.json == {
                "tenant_id": workspace_id,
                "account_id": account_id,
                "scene": "agent_preview",
                "resource_type": "agent",
                "resource_id": "agent",
            }


@pytest.mark.parametrize("locator", [locators.DatasetByDocument(), locators.DatasetByPipeline()])
def test_nested_dataset_resolution_checks_ownership_and_maps_missing_resources(
    app: Flask, rbac_domain: RBACDomain, locator: locators.DatasetByDocument | locators.DatasetByPipeline
) -> None:
    with rbac_domain.sessions.begin() as session:
        dataset = make_dataset(dataset_id="dataset", tenant_id="workspace", maintainer="owner")
        dataset.pipeline_id = "pipeline"
        session.add(dataset)
        session.add(make_document(document_id="document", dataset_id="dataset", tenant_id="workspace"))
    args = {"document_id": "document", "pipeline_id": "pipeline"}
    with app.test_request_context():
        identity = locator.locate("workspace", args)
        assert identity is not None
        assert identity == locators.ResourceIdentity(RBACResourceScope.DATASET, "dataset")
        assert locator.owner_id("workspace", identity) == "owner"
        assert locator.owner_id("other-workspace", identity) is None
        with pytest.raises(NotFound):
            locator.locate("other-workspace", args)
        with pytest.raises(NotFound):
            locator.locate("workspace", {"document_id": "missing", "pipeline_id": "missing"})
