from contextlib import nullcontext
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import delete
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import CallerKind
from controllers.openapi.auth.resource_access import authenticate_resource_token
from libs.oauth_bearer import Scope, TokenType
from models.account import Tenant
from models.model import App, AppMode, AppStar
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


@pytest.fixture
def resource_fixture(sqlite_session: Session):
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
    flask_app.login_manager = MagicMock()
    with (
        patch(
            "controllers.openapi.auth.resource_access.session_factory.create_session",
            side_effect=lambda: nullcontext(sqlite_session),
        ),
        patch("controllers.openapi.auth.resource_access.enforce_bearer_rate_limit"),
        patch(
            "controllers.openapi.auth.resource_access.EndUserService.get_or_create_end_user_by_type",
            return_value=MagicMock(),
        ) as end_user,
        patch("controllers.openapi.auth.pipeline._mount_flask_login"),
        patch("controllers.openapi.auth.pipeline.emit_wrong_surface"),
    ):
        yield flask_app, app.id, token.id, tenant.id, end_user


def call(flask_app, app_id=None, workspace_id=None, scope=Scope.APPS_RUN, allowed=None):
    path = "/apps" + (f"/{app_id}" if app_id else "")
    if workspace_id:
        path += f"?workspace_id={workspace_id}"
    with flask_app.test_request_context(path, headers={"Authorization": "Bearer sk-test"}):
        from flask import request

        request.view_args = {"app_id": app_id} if app_id else {}

        @auth_router.guard(scope=scope, allowed_token_types=allowed)
        def view(*, auth_data):
            return auth_data

        return view()


def test_bound_app_uses_machine_end_user_without_account(resource_fixture):
    flask_app, app_id, token_id, tenant_id, end_user = resource_fixture
    data = call(flask_app, app_id)
    assert data.caller_kind == CallerKind.END_USER
    assert data.account_id is None
    assert data.app.id == app_id
    end_user.assert_called_once()
    assert end_user.call_args.kwargs["user_id"] == f"resource-token:{token_id}"
    assert end_user.call_args.kwargs["tenant_id"] == tenant_id


def test_rejects_unbound_app_before_creating_caller(resource_fixture):
    flask_app, _, _, _, end_user = resource_fixture
    with pytest.raises(Forbidden, match="resource_not_authorized"):
        call(flask_app, str(uuid4()))
    end_user.assert_not_called()


def test_rejects_other_workspace(resource_fixture):
    flask_app, _, _, _, _ = resource_fixture
    with pytest.raises(Forbidden, match="resource_not_authorized"):
        call(flask_app, workspace_id=str(uuid4()), scope=Scope.APPS_READ)


def test_binding_revocation_is_immediate(resource_fixture, sqlite_session):
    flask_app, app_id, token_id, _, _ = resource_fixture
    call(flask_app, app_id)
    sqlite_session.execute(delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token_id))
    sqlite_session.commit()
    with pytest.raises(Forbidden):
        call(flask_app, app_id)


def test_token_revocation_is_immediate(resource_fixture, sqlite_session):
    flask_app, app_id, token_id, _, _ = resource_fixture
    call(flask_app, app_id)
    sqlite_session.execute(delete(ResourceAccessToken).where(ResourceAccessToken.id == token_id))
    sqlite_session.commit()
    with pytest.raises(Unauthorized):
        call(flask_app, app_id)


def test_disabled_app_is_rejected(resource_fixture, sqlite_session):
    flask_app, app_id, _, _, _ = resource_fixture
    sqlite_session.get(App, app_id).enable_api = False
    sqlite_session.commit()
    with pytest.raises(Forbidden):
        call(flask_app, app_id)


def test_app_discovery_keeps_explicit_empty_binding_set(resource_fixture, sqlite_session):
    flask_app, _, token_id, tenant_id, _ = resource_fixture
    sqlite_session.execute(delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == token_id))
    sqlite_session.commit()
    data = call(flask_app, workspace_id=tenant_id, scope=Scope.APPS_READ)
    assert data.resource_app_ids == frozenset()


def test_account_only_routes_reject_resource_token(resource_fixture):
    flask_app, _, _, _, _ = resource_fixture
    with pytest.raises(Forbidden, match="unsupported_token_type"):
        call(flask_app, scope=Scope.WORKSPACE_WRITE, allowed=frozenset({TokenType.OAUTH_ACCOUNT}))


def test_invalid_token_is_unauthorized(resource_fixture):
    flask_app, _, _, _, _ = resource_fixture
    with flask_app.test_request_context("/"):
        with pytest.raises(Unauthorized):
            authenticate_resource_token("sk-invalid")


def test_archived_workspace_is_rejected(resource_fixture, sqlite_session):
    flask_app, app_id, _, tenant_id, _ = resource_fixture
    sqlite_session.get(Tenant, tenant_id).status = "archive"
    sqlite_session.commit()
    with pytest.raises(Forbidden):
        call(flask_app, app_id)


def test_resource_token_has_workspace_read_scope(resource_fixture):
    flask_app, _, _, tenant_id, _ = resource_fixture
    with flask_app.test_request_context("/"):
        identity = authenticate_resource_token("sk-test")
    assert identity.scopes == frozenset({Scope.WORKSPACE_READ, Scope.APPS_READ, Scope.APPS_RUN})
    assert str(call(flask_app, scope=Scope.WORKSPACE_READ).tenant.id) == tenant_id


def test_workspace_list_returns_only_token_tenant(resource_fixture, sqlite_session):
    from controllers.openapi.workspaces import WorkspacesApi

    flask_app, _, _, tenant_id, _ = resource_fixture
    other_tenant = Tenant(name="Other workspace")
    other_tenant.id = str(uuid4())
    sqlite_session.add(other_tenant)
    sqlite_session.commit()
    with flask_app.test_request_context("/workspaces", headers={"Authorization": "Bearer sk-test"}):
        result, status = WorkspacesApi().get()
    assert status == 200
    assert len(result["workspaces"]) == 1
    assert result["workspaces"][0] == {
        "id": tenant_id,
        "name": "Token workspace",
        "role": "",
        "status": "normal",
        "current": True,
    }


@pytest.mark.parametrize("endpoint", ["detail", "members", "switch"])
def test_other_workspace_endpoints_reject_resource_token(resource_fixture, endpoint):
    from controllers.openapi.workspaces import WorkspaceByIdApi, WorkspaceMembersApi, WorkspaceSwitchApi

    flask_app, _, _, tenant_id, _ = resource_fixture
    methods = {
        "detail": WorkspaceByIdApi().get,
        "members": WorkspaceMembersApi().get,
        "switch": WorkspaceSwitchApi().post,
    }
    with flask_app.test_request_context("/workspaces", headers={"Authorization": "Bearer sk-test"}):
        with pytest.raises(Forbidden, match="unsupported_token_type"):
            methods[endpoint](workspace_id=tenant_id)


def test_stop_task_rejects_other_token_owner(resource_fixture):
    import inspect

    from werkzeug.exceptions import NotFound

    from controllers.openapi.app_run import AppRunTaskStopApi

    flask_app, app_id, _, _, end_user = resource_fixture
    data = call(flask_app, app_id)
    end_user.return_value.id = "machine-user"
    with (
        patch("controllers.openapi.app_run.redis_client") as redis,
        patch("controllers.openapi.app_run.AppQueueManager.set_stop_flag_no_user_check") as stop,
        patch("controllers.openapi.app_run.GraphEngineManager") as engine,
    ):
        redis.get.return_value = b"end-user-other-user"
        with pytest.raises(NotFound):
            inspect.unwrap(AppRunTaskStopApi.post)(AppRunTaskStopApi(), app_id, "task", auth_data=data)
        stop.assert_not_called()
        engine.assert_not_called()
        redis.get.return_value = b"end-user-machine-user"
        inspect.unwrap(AppRunTaskStopApi.post)(AppRunTaskStopApi(), app_id, "task", auth_data=data)
        stop.assert_called_once_with("task")


@pytest.mark.parametrize("search_unbound", [False, True])
def test_app_list_filters_unbound_apps_before_pagination(resource_fixture, sqlite_session, search_unbound):
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
            sqlite_session,
            auth_data=data,
            query=AppListQuery(workspace_id=tenant_id, name=unbound.id if search_unbound else None),
        )
    assert result.total == (0 if search_unbound else 1)
    assert [app.id for app in result.data] == ([] if search_unbound else [app_id])
