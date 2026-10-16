"""App discovery queries preserve visibility and Session boundaries."""

import json
from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import AppRequestContext, RequestContext
from models.account import Tenant
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow, WorkflowType
from repositories.app.console_repository import ConsoleAppRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.app.access import AppAccessFilter
from services.app.query_service import AppDiscoveryQuery, AppDiscoveryService
from services.entities.app_entities import PermittedAppsPage
from services.errors.app import AppDiscoveryNotFoundError


@dataclass
class DiscoveryAccess:
    access_filter: AppAccessFilter
    permitted: PermittedAppsPage
    contexts: list[RequestContext] = field(default_factory=list)
    queries: list[AppDiscoveryQuery] = field(default_factory=list)

    def visibility(self, context: RequestContext) -> AppAccessFilter:
        self.contexts.append(context)
        return self.access_filter

    def permitted_apps(self, query: AppDiscoveryQuery) -> PermittedAppsPage:
        self.queries.append(query)
        return self.permitted


@pytest.fixture
def access() -> DiscoveryAccess:
    return DiscoveryAccess(AppAccessFilter.unrestricted(), PermittedAppsPage([], 0, False))


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session], access: DiscoveryAccess) -> AppDiscoveryService:
    return AppDiscoveryService(
        apps=ConsoleAppRepository(session_factory=sqlite_session_factory),
        workspaces=WorkspaceRepository(sqlite_session_factory),
        access=access,
    )


def persist_app(session: Session, *, tenant_id: str, **values: object) -> str:
    app_id = str(uuid4())
    attributes: dict[str, object] = {
        "id": app_id,
        "tenant_id": tenant_id,
        "name": "Visible",
        "description": "description",
        "mode": AppMode.CHAT,
        "enable_api": True,
        "enable_site": False,
    }
    attributes.update(values)
    session.add(App(**attributes))
    session.commit()
    return app_id


@pytest.mark.parametrize("uuid_search", [True, False])
@pytest.mark.parametrize("visibility", ["unrestricted", "whitelisted", "own", "denied"])
def test_list_and_uuid_search_apply_same_visibility(
    sqlite_session: Session,
    service: AppDiscoveryService,
    access: DiscoveryAccess,
    uuid_search: bool,
    visibility: str,
) -> None:
    tenant_id = str(uuid4())
    context = RequestContext("req", None, "account-id", tenant_id)
    tenant = Tenant(name="Workspace")
    tenant.id = tenant_id
    sqlite_session.add(tenant)
    app_id = persist_app(sqlite_session, tenant_id=tenant_id, maintainer=context.account_id)
    persist_app(sqlite_session, tenant_id=tenant_id, enable_api=False)
    persist_app(sqlite_session, tenant_id=str(uuid4()))
    access.access_filter = AppAccessFilter(
        None if visibility == "unrestricted" else {app_id} if visibility == "whitelisted" else set(),
        visibility == "own",
    )
    query = AppDiscoveryQuery(3 if uuid_search else 1, 20, None, app_id.upper() if uuid_search else None)
    result = service.list_apps(context, query)
    assert access.contexts == [context]
    assert result.total == (0 if visibility == "denied" else 1)
    if visibility == "denied":
        assert result.items == []
        assert (result.page, result.per_page) == (query.page, query.limit)
    else:
        assert [entry.app.id for entry in result.items] == [app_id]
        assert result.items[0].workspace_name == "Workspace"
        assert (result.page, result.per_page) == ((1, 1) if uuid_search else (1, 20))


@pytest.mark.parametrize("values", [{"enable_api": False}, {"mode": AppMode.AGENT}])
def test_uuid_search_does_not_expose_unlistable_apps(
    sqlite_session: Session,
    service: AppDiscoveryService,
    values: dict[str, object],
) -> None:
    tenant_id = str(uuid4())
    app_id = persist_app(sqlite_session, tenant_id=tenant_id, **values)
    result = service.list_apps(
        RequestContext("req", None, "account-id", tenant_id), AppDiscoveryQuery(1, 20, None, app_id)
    )
    assert result.total == 0
    assert result.items == []


def test_uuid_search_is_tenant_scoped(sqlite_session: Session, service: AppDiscoveryService) -> None:
    app_id = persist_app(sqlite_session, tenant_id=str(uuid4()))
    result = service.list_apps(
        RequestContext("req", None, "account-id", str(uuid4())), AppDiscoveryQuery(1, 20, None, app_id)
    )
    assert result.items == []


@pytest.mark.parametrize("uuid_search", [False, True])
@pytest.mark.parametrize("bound", [False, True])
def test_resource_bindings_replace_account_visibility(
    sqlite_session: Session, service: AppDiscoveryService, access: DiscoveryAccess, uuid_search: bool, bound: bool
) -> None:
    tenant_id = str(uuid4())
    app_id = persist_app(sqlite_session, tenant_id=tenant_id, maintainer="token-id")
    persist_app(sqlite_session, tenant_id=tenant_id, maintainer="token-id")
    access.access_filter = AppAccessFilter(set(), can_manage_own_apps=True)
    context = RequestContext(
        "req", None, "token-id", tenant_id, resource_app_ids=frozenset({app_id}) if bound else frozenset()
    )
    result = service.list_apps(context, AppDiscoveryQuery(1, 1, None, app_id if uuid_search else None))

    assert access.contexts == []
    assert result.total == (1 if bound else 0)
    assert [entry.app.id for entry in result.items] == ([app_id] if bound else [])


def test_external_list_keeps_remote_order_and_total_after_local_filtering(
    sqlite_session: Session,
    service: AppDiscoveryService,
    access: DiscoveryAccess,
) -> None:
    tenant_id = str(uuid4())
    tenant = Tenant(name="Workspace")
    tenant.id = tenant_id
    sqlite_session.add(tenant)
    first = persist_app(sqlite_session, tenant_id=tenant_id)
    second = persist_app(sqlite_session, tenant_id=str(uuid4()))
    disabled = persist_app(sqlite_session, tenant_id=tenant_id, enable_api=False)
    access.permitted = PermittedAppsPage([second, disabled, str(uuid4()), first], 50, True)
    result = service.list_permitted_apps(AppDiscoveryQuery(2, 5, "chat", "name"))
    assert access.queries == [AppDiscoveryQuery(2, 5, "chat", "name")]
    assert (result.total, result.page, result.per_page) == (50, 2, 5)
    assert [entry.app.id for entry in result.items] == [second, first]
    assert [entry.workspace_name for entry in result.items] == [None, "Workspace"]


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.WORKFLOW])
@pytest.mark.parametrize("foreign_config", [True, False])
def test_description_materializes_only_owned_config_and_closes_session(
    sqlite_session: Session,
    sqlite_engine: Engine,
    service: AppDiscoveryService,
    mode: AppMode,
    foreign_config: bool,
) -> None:
    tenant_id = str(uuid4())
    app_id = persist_app(sqlite_session, tenant_id=tenant_id, mode=mode)
    owner = str(uuid4()) if foreign_config else app_id
    form = [{"text-input": {"variable": "industry", "label": "Industry", "required": True}}]
    app = sqlite_session.get(App, app_id)
    assert app is not None
    if mode == AppMode.CHAT:
        config = AppModelConfig(app_id=owner, user_input_form=json.dumps(form))
        app.app_model_config_id = config.id
    else:
        config = Workflow(
            id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=owner,
            type=WorkflowType.WORKFLOW,
            version=Workflow.VERSION_DRAFT,
            created_by="account-id",
            features="{}",
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "start",
                            "data": {
                                "type": "start",
                                "variables": [
                                    {
                                        "type": "text-input",
                                        "variable": "industry",
                                        "label": "Industry",
                                        "required": True,
                                    }
                                ],
                            },
                        }
                    ]
                }
            ),
        )
        app.workflow_id = config.id
    sqlite_session.add(config)
    sqlite_session.commit()
    sqlite_session.close()
    context = AppRequestContext(tenant_id=tenant_id, app_id=app_id)
    connections: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        connections.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        connections.discard(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        result = service.describe(context, None)
        assert not connections
        assert result.app.id == app_id
        if foreign_config:
            assert result.config is None
        else:
            assert result.config is not None
            assert result.config.user_input_form[0]["text-input"]["variable"] == "industry"
        assert service.describe(context, {"info"}).config is None
        assert not connections
        with pytest.raises(AppDiscoveryNotFoundError):
            service.describe(AppRequestContext(tenant_id=str(uuid4()), app_id=app_id), None)
        assert not connections
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
