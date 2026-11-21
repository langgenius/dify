"""App discovery queries preserve visibility and Session boundaries."""

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import SubjectType
from machinery.context import AppRequestContext, CallerIdentity, RequestContext
from machinery.scope import UNRESTRICTED, IdScope
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow, WorkflowType
from repositories.app.console_repository import ConsoleAppRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.app.access import AppAccessFilter
from services.app.query_service import (
    AppDiscoveryQuery,
    AppDiscoveryService,
    AppListLogin,
)
from services.entities.app_entities import PermittedAppsPage
from services.errors.app import AppDiscoveryNotFoundError


@dataclass
class DiscoveryAccess:
    """``filters`` gives a workspace its own visibility, as a role there would; others get ``access_filter``."""

    access_filter: AppAccessFilter
    permitted: PermittedAppsPage | list[PermittedAppsPage]
    filters: dict[str, AppAccessFilter] = field(default_factory=dict)
    contexts: list[RequestContext] = field(default_factory=list)
    queries: list[AppDiscoveryQuery] = field(default_factory=list)

    def visibility(self, context: RequestContext) -> AppAccessFilter:
        self.contexts.append(context)
        return self.filters.get(context.active_workspace_id, self.access_filter)

    def permitted_apps(self, query: AppDiscoveryQuery) -> PermittedAppsPage:
        self.queries.append(query)
        if isinstance(self.permitted, list):
            return self.permitted[query.page - 1]
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
    app = App()
    for key, value in attributes.items():
        setattr(app, key, value)
    session.add(app)
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
    app_id = persist_app(
        sqlite_session, tenant_id=tenant_id, maintainer="other" if visibility == "denied" else context.account_id
    )
    persist_app(sqlite_session, tenant_id=tenant_id, enable_api=False)
    persist_app(sqlite_session, tenant_id=str(uuid4()))
    access.access_filter = AppAccessFilter(
        None if visibility == "unrestricted" else {app_id} if visibility == "whitelisted" else set(),
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
    access.access_filter = AppAccessFilter(set())
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
            _features="{}",
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


@pytest.mark.parametrize("uuid_search", [False, True])
@pytest.mark.parametrize("visibility", ["unrestricted", "whitelisted", "own", "denied"])
@pytest.mark.parametrize("selected", [False, True])
def test_personal_token_scope_intersects_account_visibility_before_pagination(
    sqlite_session: Session,
    service: AppDiscoveryService,
    access: DiscoveryAccess,
    uuid_search: bool,
    visibility: str,
    selected: bool,
) -> None:
    tenant_id = str(uuid4())
    app_id = persist_app(
        sqlite_session, tenant_id=tenant_id, maintainer="account-id" if visibility == "own" else "other"
    )
    persist_app(sqlite_session, tenant_id=tenant_id, maintainer="account-id")
    access.access_filter = AppAccessFilter(
        None if visibility == "unrestricted" else {app_id} if visibility == "whitelisted" else set(),
    )
    context = RequestContext(
        "req",
        None,
        "account-id",
        tenant_id,
        personal_app_ids=frozenset({app_id}) if selected else frozenset(),
    )
    result = service.list_apps(context, AppDiscoveryQuery(1, 1, None, app_id if uuid_search else None))
    expected = [app_id] if selected and visibility != "denied" else []
    assert access.contexts == [context]
    assert result.total == len(expected)
    assert [entry.app.id for entry in result.items] == expected


# --- One app list for every login: the rule per login kind and the cross-workspace join ---


def persist_workspace(
    session: Session, name: str, *, created: datetime, status: TenantStatus = TenantStatus.NORMAL
) -> str:
    tenant = Tenant(name=name)
    tenant.id = str(uuid4())
    tenant.created_at = created
    tenant.status = status
    session.add(tenant)
    session.commit()
    return tenant.id


def persist_account(session: Session, *, status: AccountStatus = AccountStatus.ACTIVE) -> str:
    account = Account(name="Member", email=f"{uuid4()}@example.test", status=status)
    session.add(account)
    session.commit()
    return account.id


def join(session: Session, account_id: str, workspace_id: str, role: TenantAccountRole) -> None:
    session.add(TenantAccountJoin(tenant_id=workspace_id, account_id=account_id, role=role))
    session.commit()


def persist_apps(session: Session, workspace_id: str, names: list[str], *, start: datetime) -> list[str]:
    """Newest first under the list's default order (last modified), so the list order is the order given."""
    return [
        persist_app(session, tenant_id=workspace_id, name=name, updated_at=start - timedelta(minutes=index))
        for index, name in enumerate(names)
    ]


def login(
    kind: SubjectType,
    account_id: str,
    workspace_id: str | None = None,
    *,
    resource_app_ids: frozenset[str] | None = None,
    personal_app_ids: IdScope = UNRESTRICTED,
) -> AppListLogin:
    caller = CallerIdentity(
        request_id="req",
        trace_id=None,
        account_id=account_id,
        resource_app_ids=resource_app_ids,
        personal_app_ids=personal_app_ids,
    )
    return AppListLogin(kind=kind, caller=caller, workspace_id=workspace_id)


def every_page(
    service: AppDiscoveryService, who: AppListLogin, limit: int, *, mode: str | None = None, name: str | None = None
) -> tuple[list[str], int]:
    first = service.list_apps_for(who, AppDiscoveryQuery(1, limit, mode, name))
    results = [first] + [
        service.list_apps_for(who, AppDiscoveryQuery(page, limit, mode, name))
        for page in range(2, -(-first.total // limit) + 1)
    ]
    assert [(result.page, result.per_page) for result in results] == [
        (page, limit) for page in range(1, len(results) + 1)
    ]
    return [entry.app.id for result in results for entry in result.items], first.total


@dataclass(frozen=True)
class TwoWorkspaces:
    account_id: str
    first: str
    second: str
    first_apps: list[str]
    second_apps: list[str]


@pytest.fixture
def two_workspaces(sqlite_session: Session, access: DiscoveryAccess) -> TwoWorkspaces:
    """An Editor in the older workspace (sees all 3 apps), Normal in the newer one (sees 2 of its 3 apps)."""
    now = datetime(2026, 11, 17, 12, 0, 0)
    account_id = persist_account(sqlite_session)
    second = persist_workspace(sqlite_session, "Second", created=now - timedelta(days=1))
    first = persist_workspace(sqlite_session, "First", created=now - timedelta(days=2))
    join(sqlite_session, account_id, first, TenantAccountRole.EDITOR)
    join(sqlite_session, account_id, second, TenantAccountRole.NORMAL)
    first_apps = persist_apps(sqlite_session, first, ["a1", "a2", "a3"], start=now)
    second_apps = persist_apps(sqlite_session, second, ["b1", "b2", "b3"], start=now)
    access.filters[second] = AppAccessFilter({second_apps[0], second_apps[2]})
    return TwoWorkspaces(account_id, first, second, first_apps, [second_apps[0], second_apps[2]])


@pytest.mark.parametrize("limit", [1, 2, 3, 4, 5, 100])
def test_an_account_list_without_a_workspace_joins_each_workspace_list_in_workspace_order(
    service: AppDiscoveryService, two_workspaces: TwoWorkspaces, limit: int
) -> None:
    w = two_workspaces
    per_workspace = [
        every_page(service, login(SubjectType.ACCOUNT, w.account_id, workspace), limit)
        for workspace in (w.first, w.second)
    ]
    joined, total = every_page(service, login(SubjectType.ACCOUNT, w.account_id), limit)
    assert joined == per_workspace[0][0] + per_workspace[1][0] == w.first_apps + w.second_apps
    assert total == per_workspace[0][1] + per_workspace[1][1] == 5


def test_a_page_can_span_the_workspace_boundary(service: AppDiscoveryService, two_workspaces: TwoWorkspaces) -> None:
    w = two_workspaces
    result = service.list_apps_for(login(SubjectType.ACCOUNT, w.account_id), AppDiscoveryQuery(2, 2, None, None))
    assert [entry.app.id for entry in result.items] == [w.first_apps[2], w.second_apps[0]]
    assert [entry.workspace_name for entry in result.items] == ["First", "Second"]
    assert (result.total, result.page, result.per_page) == (5, 2, 2)
    beyond = service.list_apps_for(login(SubjectType.ACCOUNT, w.account_id), AppDiscoveryQuery(4, 2, None, None))
    assert (beyond.items, beyond.total) == ([], 5)


def test_filters_apply_in_every_workspace(service: AppDiscoveryService, two_workspaces: TwoWorkspaces) -> None:
    w = two_workspaces
    by_name, total = every_page(service, login(SubjectType.ACCOUNT, w.account_id), 20, name="3")
    assert (by_name, total) == ([w.first_apps[2], w.second_apps[1]], 2)
    by_mode, _ = every_page(service, login(SubjectType.ACCOUNT, w.account_id), 20, mode="workflow")
    assert by_mode == []


@pytest.mark.parametrize("in_second", [True, False])
def test_an_app_id_as_name_finds_the_app_in_whichever_workspace_holds_it(
    service: AppDiscoveryService, two_workspaces: TwoWorkspaces, in_second: bool
) -> None:
    w = two_workspaces
    app_id = w.second_apps[1] if in_second else w.first_apps[0]
    result = service.list_apps_for(login(SubjectType.ACCOUNT, w.account_id), AppDiscoveryQuery(1, 20, None, app_id))
    assert [entry.app.id for entry in result.items] == [app_id]
    assert result.total == 1


def test_an_app_id_the_role_hides_is_not_found(
    sqlite_session: Session, service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    w = two_workspaces
    hidden = next(
        app.id for app in sqlite_session.scalars(select(App).where(App.tenant_id == w.second, App.name == "b2"))
    )
    result = service.list_apps_for(login(SubjectType.ACCOUNT, w.account_id), AppDiscoveryQuery(1, 20, None, hidden))
    assert (result.items, result.total) == ([], 0)


def test_a_personal_token_with_selected_apps_lists_only_those_in_every_workspace(
    service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    w = two_workspaces
    selected = frozenset({w.first_apps[1], w.second_apps[1], str(uuid4())})
    who = login(SubjectType.ACCOUNT, w.account_id, personal_app_ids=selected)
    assert every_page(service, who, 1) == ([w.first_apps[1], w.second_apps[1]], 2)


def test_a_personal_token_with_app_access_none_lists_nothing(
    service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    who = login(SubjectType.ACCOUNT, two_workspaces.account_id, personal_app_ids=frozenset())
    assert every_page(service, who, 20) == ([], 0)


def test_a_named_workspace_answers_exactly_as_the_workspace_list(
    service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    w = two_workspaces
    for workspace in (w.first, w.second):
        for query in (AppDiscoveryQuery(1, 2, None, None), AppDiscoveryQuery(3, 5, "chat", w.first_apps[0])):
            context = RequestContext("req", None, w.account_id, workspace)
            assert service.list_apps_for(
                login(SubjectType.ACCOUNT, w.account_id, workspace), query
            ) == service.list_apps(context, query)


def test_workspaces_the_membership_check_refuses_are_left_out(
    sqlite_session: Session, service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    """Archived workspaces and other accounts' workspaces answer 404 with a workspace_id, so they add nothing."""
    w = two_workspaces
    archived = persist_workspace(sqlite_session, "Archived", created=datetime(2026, 1, 1), status=TenantStatus.ARCHIVE)
    join(sqlite_session, w.account_id, archived, TenantAccountRole.OWNER)
    persist_app(sqlite_session, tenant_id=archived, name="archived app")
    elsewhere = persist_workspace(sqlite_session, "Elsewhere", created=datetime(2026, 1, 2))
    join(sqlite_session, persist_account(sqlite_session), elsewhere, TenantAccountRole.OWNER)
    persist_app(sqlite_session, tenant_id=elsewhere, name="someone else's app")
    assert every_page(service, login(SubjectType.ACCOUNT, w.account_id), 20) == (
        w.first_apps + w.second_apps,
        5,
    )


def test_an_account_in_no_workspace_lists_nothing(sqlite_session: Session, service: AppDiscoveryService) -> None:
    assert every_page(service, login(SubjectType.ACCOUNT, persist_account(sqlite_session)), 20) == ([], 0)


def test_unlistable_rows_count_in_the_total_and_drop_from_the_page_as_in_one_workspace(
    sqlite_session: Session, service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    """The workspace list pages query rows and then drops modes it does not list; the joined list does the same."""
    w = two_workspaces
    persist_app(
        sqlite_session, tenant_id=w.first, name="pipeline", mode=AppMode.RAG_PIPELINE, updated_at=datetime(2027, 1, 1)
    )
    one = service.list_apps(RequestContext("req", None, w.account_id, w.first), AppDiscoveryQuery(1, 2, None, None))
    joined = service.list_apps_for(login(SubjectType.ACCOUNT, w.account_id), AppDiscoveryQuery(1, 2, None, None))
    assert [entry.app.id for entry in joined.items] == [entry.app.id for entry in one.items] == [w.first_apps[0]]
    assert (joined.total, one.total) == (6, 4)


def test_a_workspace_token_lists_the_apps_of_its_workspace(
    service: AppDiscoveryService, two_workspaces: TwoWorkspaces
) -> None:
    w = two_workspaces
    bound = frozenset({w.first_apps[0], w.first_apps[2], w.second_apps[0]})
    who = login(SubjectType.RESOURCE_ACCESS, "token-id", w.first, resource_app_ids=bound)
    query = AppDiscoveryQuery(1, 20, None, None)
    context = RequestContext("req", None, "token-id", w.first, resource_app_ids=bound)
    assert service.list_apps_for(who, query) == service.list_apps(context, query)
    assert [entry.app.id for entry in service.list_apps_for(who, query).items] == [
        w.first_apps[0],
        w.first_apps[2],
    ]


def test_an_external_sso_login_gets_the_permitted_list_unchanged(
    service: AppDiscoveryService,
    access: DiscoveryAccess,
    two_workspaces: TwoWorkspaces,
) -> None:
    w = two_workspaces
    access.permitted = PermittedAppsPage([w.second_apps[0], w.first_apps[1]], 30, True)
    query = AppDiscoveryQuery(2, 2, "chat", "name")
    assert service.list_apps_for(login(SubjectType.EXTERNAL_SSO, ""), query) == (service.list_permitted_apps(query))
    assert access.queries == [query, query]


def test_every_login_kind_has_a_rule(service: AppDiscoveryService, sqlite_session: Session) -> None:
    """A login kind added later must get a rule here before it can list apps."""
    workspace = persist_workspace(sqlite_session, "Any", created=datetime(2026, 1, 1))
    for kind in SubjectType:
        result = service.list_apps_for(
            login(kind, "", workspace, resource_app_ids=frozenset()), AppDiscoveryQuery(1, 1, None, None)
        )
        assert result.items == []
