from collections.abc import Callable, Generator
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import delete
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi._catalog import CATALOG_HEADER, catalog_for
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import CheckScope, CheckSubject
from controllers.openapi.auth.resource_access import authenticate_resource_token
from controllers.openapi.auth.router import subject_router
from controllers.openapi.auth.spec import CatalogMeta, EndpointSpec, Kind
from controllers.openapi.auth.subjects import AccountSubject, ResourceAccessSubject
from core.db.session_factory import get_session_maker
from extensions.application_services.app import AppServices
from extensions.application_services.resource_access_token import build_resource_access_token_service
from libs.oauth_bearer import Scope, TokenType
from models.account import Tenant, TenantStatus
from models.enums import CreatorUserRole
from models.model import App, AppMode, AppStar, EndUser
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, App, AppStar, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)

ResourceFixture = tuple[Flask, str, str, str, MagicMock]


@pytest.fixture
def resource_fixture(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    app_services: AppServices,
) -> Generator[ResourceFixture]:
    config_overrides(ENABLE_OAUTH_BEARER=True)
    tenant = Tenant(name="Token workspace")
    tenant.id = str(uuid4())
    app = App(
        id=str(uuid4()), tenant_id=tenant.id, name="Bound app", mode=AppMode.CHAT, enable_api=True, enable_site=False
    )
    token = ResourceAccessToken(
        id=str(uuid4()), tenant_id=tenant.id, name="CLI", token="sk-test", track_id="test", created_by=str(uuid4())
    )
    relation = ResourceAccessTokenRelation(
        token_id=token.id, resource_type=ResourceAccessTokenResourceType.APP, app_id=app.id
    )
    sqlite_session.add_all([tenant, app, token, relation])
    sqlite_session.commit()
    flask_app = Flask(__name__)
    flask_app.login_manager = MagicMock()  # type: ignore[attr-defined]
    workspaces = SimpleNamespace(
        identity=SimpleNamespace(get_workspace=lambda workspace_id: sqlite_session.get(Tenant, workspace_id)),
        management=SimpleNamespace(get=lambda workspace_id: sqlite_session.get(Tenant, workspace_id)),
    )
    with (
        patch(
            "controllers.openapi.auth.resource_access.application_services",
            return_value=SimpleNamespace(
                resource_access_tokens=build_resource_access_token_service(database_client=get_session_maker()),
                workspaces=workspaces,
            ),
        ),
        patch("controllers.openapi.auth.resource_access.enforce_bearer_rate_limit"),
        patch(
            "controllers.openapi.auth.subjects.application_services",
            return_value=MagicMock(),
        ) as end_user,
        patch("controllers.openapi.auth.pipelines._mount_flask_login"),
        patch("controllers.openapi.auth.requirements.emit_wrong_surface"),
        patch(
            "controllers.openapi.apps.application_services",
            return_value=SimpleNamespace(apps=app_services, workspaces=workspaces),
        ),
    ):
        end_user = end_user.return_value.app_scoped_end_users.commands.get_or_create_end_user_by_type
        end_user.return_value = EndUser(id="machine-user", tenant_id=tenant.id, app_id=app.id, type="openapi")
        yield flask_app, app.id, token.id, tenant.id, end_user


def call(
    flask_app: Flask,
    app_id: str | None = None,
    workspace_id: str | None = None,
    scope: Scope = Scope.APPS_RUN,
    allowed: frozenset[TokenType] | None = None,
) -> Context:
    path = "/apps" + (f"/{app_id}" if app_id else "")
    if workspace_id:
        path += f"?workspace_id={workspace_id}"
    with flask_app.test_request_context(
        path, headers={"Authorization": "Bearer sk-test", CATALOG_HEADER: catalog_for(flask_app)[1]}
    ):
        from flask import request

        request.view_args = {"app_id": app_id} if app_id else {}

        @subject_router.guard(
            EndpointSpec(
                requirements=(
                    CheckSubject(allowed=(AccountSubject,) if allowed else (ResourceAccessSubject,)),
                    CheckScope(scope),
                ),
                catalog=CatalogMeta(op="test.resource", kind=Kind.OBJECT, summary="Resource token test"),
            )
        )
        def view(*, ctx: Context) -> Context:
            return ctx

        return view()


def test_bound_app_uses_machine_end_user_without_account(resource_fixture: ResourceFixture) -> None:
    flask_app, app_id, token_id, tenant_id, end_user = resource_fixture
    data = call(flask_app, app_id)
    assert data.subject.caller_role == CreatorUserRole.END_USER
    assert data.subject.account_id is None
    assert data.app.id == app_id
    end_user.assert_called_once()
    assert end_user.call_args.kwargs["user_id"] == f"resource-token:{token_id}"
    assert end_user.call_args.kwargs["tenant_id"] == tenant_id


def test_rejects_unbound_app_before_creating_caller(resource_fixture: ResourceFixture) -> None:
    flask_app, _, _, _, end_user = resource_fixture
    with pytest.raises(Forbidden, match="resource_not_authorized"):
        call(flask_app, str(uuid4()))
    end_user.assert_not_called()


def test_rejects_other_workspace(resource_fixture: ResourceFixture) -> None:
    flask_app, _, _, _, _ = resource_fixture
    with pytest.raises(Forbidden, match="resource_not_authorized"):
        call(flask_app, workspace_id=str(uuid4()), scope=Scope.APPS_READ)


def test_binding_revocation_is_immediate(resource_fixture: ResourceFixture, sqlite_session: Session) -> None:
    flask_app, app_id, token_id, _, _ = resource_fixture
    call(flask_app, app_id)
    sqlite_session.execute(delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token_id))
    sqlite_session.commit()
    with pytest.raises(Forbidden):
        call(flask_app, app_id)


def test_token_revocation_is_immediate(resource_fixture: ResourceFixture, sqlite_session: Session) -> None:
    flask_app, app_id, token_id, _, _ = resource_fixture
    call(flask_app, app_id)
    sqlite_session.execute(delete(ResourceAccessToken).where(ResourceAccessToken.id == token_id))
    sqlite_session.commit()
    with pytest.raises(Unauthorized):
        call(flask_app, app_id)


def test_disabled_app_is_rejected(resource_fixture: ResourceFixture, sqlite_session: Session) -> None:
    flask_app, app_id, _, _, _ = resource_fixture
    app = sqlite_session.get(App, app_id)
    assert app is not None
    app.enable_api = False
    sqlite_session.commit()
    with pytest.raises(Forbidden):
        call(flask_app, app_id)


def test_app_discovery_keeps_explicit_empty_binding_set(
    resource_fixture: ResourceFixture, sqlite_session: Session
) -> None:
    flask_app, _, token_id, tenant_id, _ = resource_fixture
    sqlite_session.execute(delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token_id))
    sqlite_session.commit()
    data = call(flask_app, workspace_id=tenant_id, scope=Scope.APPS_READ)
    assert data.resource_app_ids == frozenset()


def test_account_only_routes_reject_resource_token(resource_fixture: ResourceFixture) -> None:
    flask_app, _, _, _, _ = resource_fixture
    with pytest.raises(Forbidden, match="unsupported_token_type"):
        call(flask_app, scope=Scope.WORKSPACE_WRITE, allowed=frozenset({TokenType.OAUTH_ACCOUNT}))


def test_invalid_token_is_unauthorized(resource_fixture: ResourceFixture) -> None:
    flask_app, _, _, _, _ = resource_fixture
    with flask_app.test_request_context("/"):
        with pytest.raises(Unauthorized):
            authenticate_resource_token("sk-invalid")


def test_archived_workspace_is_rejected(resource_fixture: ResourceFixture, sqlite_session: Session) -> None:
    flask_app, app_id, _, tenant_id, _ = resource_fixture
    tenant = sqlite_session.get(Tenant, tenant_id)
    assert tenant is not None
    tenant.status = TenantStatus.ARCHIVE
    sqlite_session.commit()
    with pytest.raises(Forbidden):
        call(flask_app, app_id)


def test_resource_token_has_workspace_read_scope(resource_fixture: ResourceFixture) -> None:
    flask_app, _, _, tenant_id, _ = resource_fixture
    with flask_app.test_request_context("/"):
        identity = authenticate_resource_token("sk-test")
    assert identity.scopes == frozenset({Scope.WORKSPACE_READ, Scope.APPS_READ, Scope.APPS_RUN})
    assert call(flask_app, scope=Scope.WORKSPACE_READ).workspace.id == tenant_id


def test_workspace_list_returns_only_token_tenant(resource_fixture: ResourceFixture, sqlite_session: Session) -> None:
    from controllers.openapi.workspaces import WorkspacesApi

    flask_app, _, _, tenant_id, _ = resource_fixture
    other_tenant = Tenant(name="Other workspace")
    other_tenant.id = str(uuid4())
    sqlite_session.add(other_tenant)
    sqlite_session.commit()
    with flask_app.test_request_context(
        "/workspaces", headers={"Authorization": "Bearer sk-test", CATALOG_HEADER: catalog_for(flask_app)[1]}
    ):
        result, status = WorkspacesApi().get()
    assert status == 200
    assert len(result["data"]) == 1
    assert result["data"][0] == {
        "id": tenant_id,
        "name": "Token workspace",
        "role": "",
        "status": "normal",
        "current": True,
    }


@pytest.mark.parametrize("endpoint", ["detail", "members", "switch"])
def test_other_workspace_endpoints_reject_resource_token(resource_fixture: ResourceFixture, endpoint: str) -> None:
    from controllers.openapi.workspaces import WorkspaceByIdApi, WorkspaceMembersApi, WorkspaceSwitchApi

    flask_app, _, _, tenant_id, _ = resource_fixture
    methods = {
        "detail": WorkspaceByIdApi().get,
        "members": WorkspaceMembersApi().get,
        "switch": WorkspaceSwitchApi().post,
    }
    with flask_app.test_request_context(
        "/workspaces", headers={"Authorization": "Bearer sk-test", CATALOG_HEADER: catalog_for(flask_app)[1]}
    ):
        with pytest.raises(Forbidden, match="unsupported_token_type"):
            methods[endpoint](workspace_id=tenant_id)


def test_stop_task_rejects_other_token_owner(resource_fixture: ResourceFixture) -> None:
    import inspect

    from werkzeug.exceptions import NotFound

    from controllers.openapi.app_run import AppRunTaskStopApi

    flask_app, app_id, _, _, end_user = resource_fixture
    data = call(flask_app, app_id)
    end_user.return_value.id = "machine-user"
    with (
        patch("controllers.openapi.app_run.redis_client") as redis,
        patch("controllers.openapi.app_run.AppQueueManager.set_stop_flag_no_user_check") as stop,
        patch("controllers.openapi.app_run.send_abort_command") as abort,
    ):
        redis.get.return_value = b"end-user-other-user"
        with pytest.raises(NotFound):
            inspect.unwrap(AppRunTaskStopApi.post)(AppRunTaskStopApi(), data, app_id, "task")
        stop.assert_not_called()
        abort.assert_not_called()
        redis.get.return_value = b"end-user-machine-user"
        inspect.unwrap(AppRunTaskStopApi.post)(AppRunTaskStopApi(), data, app_id, "task")
        stop.assert_called_once_with("task")
        abort.assert_called_once_with("task")


@pytest.mark.parametrize("search_unbound", [False, True])
def test_app_list_filters_unbound_apps_before_pagination(
    resource_fixture: ResourceFixture, sqlite_session: Session, search_unbound: bool
) -> None:
    import inspect

    from controllers.openapi._models import AppListQuery
    from controllers.openapi.apps import AppListApi

    flask_app, app_id, _, tenant_id, _ = resource_fixture
    unbound = App(
        id=str(uuid4()), tenant_id=tenant_id, name="Unbound app", mode=AppMode.CHAT, enable_api=True, enable_site=False
    )
    sqlite_session.add(unbound)
    sqlite_session.commit()
    with flask_app.test_request_context("/"):
        data = call(flask_app, workspace_id=tenant_id, scope=Scope.APPS_READ)
        result = inspect.unwrap(AppListApi.get)(
            AppListApi(),
            data,
            query=AppListQuery(workspace_id=tenant_id, name=unbound.id if search_unbound else None),
        )
    assert result.total == (0 if search_unbound else 1)
    assert [app.id for app in result.data] == ([] if search_unbound else [app_id])
