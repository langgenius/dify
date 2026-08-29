from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from configs import dify_config
from controllers.console.agent.roster import AgentApiKeyListApi
from controllers.console.apikey import (
    AppApiKeyListResource,
    BaseApiKeyListResource,
    BaseApiKeyResource,
    DatasetApiKeyListResource,
)
from controllers.console.datasets.datasets import DatasetApiKeyApi
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.enums import ApiTokenType
from models.model import ApiToken, App, AppMode, IconType
from services.agent.errors import AgentAccessNotReadyError


def _make_list_resource() -> BaseApiKeyListResource:
    resource = BaseApiKeyListResource()
    resource.resource_type = ApiTokenType.APP
    resource.resource_model = App
    resource.resource_id_field = "app_id"
    resource.token_prefix = "app-"
    return resource


def _make_key_resource() -> BaseApiKeyResource:
    resource = BaseApiKeyResource()
    resource.resource_type = ApiTokenType.APP
    resource.resource_model = App
    resource.resource_id_field = "app_id"
    return resource


def _make_account(role: TenantAccountRole) -> Account:
    account = Account(
        name="Test User",
        email=f"{role.value}@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = f"{role.value}-user"
    account.role = role
    return account


def _persist_app(session: Session, *, mode: AppMode = AppMode.CHAT) -> App:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="API key app",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=True,
    )
    session.add(app)
    session.flush()
    return app


def test_list_api_keys_uses_injected_session_and_tenant_id(sqlite_session: Session) -> None:
    resource = _make_list_resource()
    raw_get = cast(
        Callable[[BaseApiKeyListResource, object, str, str], dict[str, object]],
        inspect.unwrap(BaseApiKeyListResource.get),
    )
    session = sqlite_session
    _persist_app(session)
    api_key = ApiToken(
        type=ApiTokenType.APP,
        token="app-token",
        app_id="app-1",
        tenant_id="tenant-1",
    )
    api_key.id = "key-1"
    session.add(api_key)
    session.add(
        ApiToken(
            type=ApiTokenType.APP,
            token="foreign-app-token",
            app_id="app-1",
            tenant_id="tenant-2",
        )
    )
    legacy_api_key = ApiToken(type=ApiTokenType.APP, token="legacy-app-token", app_id="app-1", tenant_id=None)
    session.add(legacy_api_key)
    session.commit()

    result = raw_get(resource, session, "app-1", "tenant-1")
    data = cast(list[dict[str, object]], result["data"])

    assert {item["token"] for item in data} == {"app-token", "legacy-app-token"}


def test_create_api_key_uses_injected_session_and_tenant_id(sqlite_session: Session) -> None:
    resource = _make_list_resource()
    raw_post = cast(
        Callable[[BaseApiKeyListResource, object, str, str], tuple[dict[str, object], int]],
        inspect.unwrap(BaseApiKeyListResource.post),
    )
    session = sqlite_session
    _persist_app(session)
    session.add_all(
        [
            ApiToken(type=ApiTokenType.APP, token=f"foreign-token-{index}", app_id="app-1", tenant_id="tenant-2")
            for index in range(resource.max_keys)
        ]
    )
    session.commit()
    commits: list[str] = []
    event.listen(session, "after_commit", lambda _session: commits.append("commit"))

    with patch(
        "controllers.console.apikey.ApiToken.generate_api_key", return_value="app-generated-token"
    ) as generate_api_key:
        result, status = raw_post(resource, session, "app-1", "tenant-1")

    assert status == 201
    assert result["token"] == "app-generated-token"
    api_token = session.scalar(select(ApiToken).where(ApiToken.token == "app-generated-token"))
    assert api_token is not None
    assert api_token.app_id == "app-1"
    assert api_token.tenant_id == "tenant-1"
    assert api_token.type == ApiTokenType.APP
    generate_api_key.assert_called_once_with("app-", 24, session=session)
    assert commits == ["commit"]


def test_create_api_key_counts_legacy_tokens(sqlite_session: Session) -> None:
    resource = _make_list_resource()
    _persist_app(sqlite_session)
    sqlite_session.add_all(
        [
            ApiToken(type=ApiTokenType.APP, token=f"legacy-token-{index}", app_id="app-1", tenant_id=None)
            for index in range(resource.max_keys)
        ]
    )
    sqlite_session.commit()

    with pytest.raises(BadRequest):
        resource._create_api_key("app-1", "tenant-1", session=sqlite_session)


def test_create_agent_api_key_requires_published_access(sqlite_session: Session) -> None:
    resource = _make_list_resource()
    session = sqlite_session
    app = _persist_app(session, mode=AppMode.AGENT)

    with patch(
        "controllers.console.apikey.AppService.ensure_agent_app_access_ready",
        side_effect=AgentAccessNotReadyError(),
    ) as ensure_access_ready:
        with pytest.raises(AgentAccessNotReadyError):
            resource._create_api_key("app-1", "tenant-1", session=session)

    ensure_access_ready.assert_called_once_with(app, session=session)
    assert session.scalar(select(ApiToken)) is None


def test_delete_api_key_rejects_non_admin_account(sqlite_session: Session) -> None:
    resource = _make_key_resource()
    raw_delete = cast(
        Callable[[BaseApiKeyResource, object, str, str, str, Account], tuple[str, int]],
        inspect.unwrap(BaseApiKeyResource.delete),
    )
    session = sqlite_session
    _persist_app(session)

    with pytest.raises(Forbidden):
        raw_delete(
            resource,
            session,
            "app-1",
            "key-1",
            "tenant-1",
            _make_account(TenantAccountRole.NORMAL),
        )


def test_delete_api_key_uses_injected_session_user_and_tenant(sqlite_session: Session) -> None:
    resource = _make_key_resource()
    raw_delete = cast(
        Callable[[BaseApiKeyResource, object, str, str, str, Account], tuple[str, int]],
        inspect.unwrap(BaseApiKeyResource.delete),
    )
    session = sqlite_session
    _persist_app(session)
    api_key = ApiToken(type=ApiTokenType.APP, token="app-token", app_id="app-1", tenant_id=None)
    api_key.id = "key-1"
    session.add(api_key)
    session.commit()
    commits: list[str] = []
    event.listen(session, "after_commit", lambda _session: commits.append("commit"))

    with patch("controllers.console.apikey.ApiTokenCache.delete") as delete_cache:
        result, status = raw_delete(
            resource,
            session,
            "app-1",
            "key-1",
            "tenant-1",
            _make_account(TenantAccountRole.OWNER),
        )

    delete_cache.assert_called_once_with("app-token", ApiTokenType.APP)
    assert session.get(ApiToken, "key-1") is None
    assert commits == ["commit"]
    assert result == ""
    assert status == 204


def test_delete_api_key_rejects_foreign_tenant_token(sqlite_session: Session) -> None:
    resource = _make_key_resource()
    session = sqlite_session
    _persist_app(session)
    api_key = ApiToken(type=ApiTokenType.APP, token="foreign-token", app_id="app-1", tenant_id="tenant-2")
    api_key.id = "key-1"
    session.add(api_key)
    session.commit()

    with patch("controllers.console.apikey.ApiTokenCache.delete") as delete_cache:
        with pytest.raises(NotFound):
            resource._delete_api_key(
                "app-1",
                "key-1",
                "tenant-1",
                _make_account(TenantAccountRole.OWNER),
                session=session,
            )

    delete_cache.assert_not_called()
    assert session.get(ApiToken, "key-1") is api_key


def test_api_key_lists_require_matching_rbac_permission() -> None:
    app = Flask(__name__)
    account = _make_account(TenantAccountRole.OWNER)
    api_id = UUID("00000000-0000-0000-0000-000000000001")
    cases = [
        (
            lambda: AppApiKeyListResource().get(resource_id=api_id),
            [(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION, True)],
        ),
        (
            lambda: AgentApiKeyListApi().get(agent_id=api_id),
            [
                (RBACResourceScope.WORKSPACE, RBACPermission.AGENT_MANAGE, False),
                (RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION, True),
            ],
        ),
        (
            lambda: DatasetApiKeyApi().get(),
            [(RBACResourceScope.DATASET, RBACPermission.DATASET_API_KEY_MANAGE, False)],
        ),
        (
            lambda: DatasetApiKeyListResource().get(resource_id=api_id),
            [(RBACResourceScope.DATASET, RBACPermission.DATASET_API_KEY_MANAGE, True)],
        ),
    ]

    with (
        app.test_request_context("/"),
        patch.object(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch.object(dify_config, "LOGIN_DISABLED", True),
        patch.object(dify_config, "RBAC_ENABLED", True),
        patch("controllers.console.wraps.current_account_with_tenant", return_value=(account, "tenant-1")),
        patch("controllers.common.wraps.current_account_with_tenant", return_value=(account, "tenant-1")),
        patch.object(BaseApiKeyListResource, "_get_api_key_list") as get_api_key_list,
    ):
        for invoke, expected_gates in cases:
            with patch(
                "controllers.common.wraps.enforce_rbac_access",
                side_effect=[None] * (len(expected_gates) - 1) + [Forbidden()],
            ) as enforce_rbac_access:
                with pytest.raises(Forbidden):
                    invoke()

            assert [
                (kwargs["resource_type"], kwargs["scene"], kwargs["resource_required"])
                for _, kwargs in enforce_rbac_access.call_args_list
            ] == expected_gates

    get_api_key_list.assert_not_called()


def test_api_key_lists_reject_legacy_read_only_members() -> None:
    app = Flask(__name__)
    account = _make_account(TenantAccountRole.NORMAL)
    api_id = UUID("00000000-0000-0000-0000-000000000001")
    current_user = MagicMock()
    current_user._get_current_object.return_value = account
    current_user.has_edit_permission = False

    with (
        app.test_request_context("/"),
        patch.object(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch.object(dify_config, "LOGIN_DISABLED", True),
        patch.object(dify_config, "RBAC_ENABLED", False),
        patch("libs.login.current_user", current_user),
        patch("controllers.console.wraps.current_account_with_tenant", return_value=(account, "tenant-1")),
        patch.object(BaseApiKeyListResource, "_get_api_key_list") as get_api_key_list,
    ):
        for invoke in (
            lambda: AppApiKeyListResource().get(resource_id=api_id),
            lambda: AgentApiKeyListApi().get(agent_id=api_id),
            lambda: DatasetApiKeyApi().get(),
            lambda: DatasetApiKeyListResource().get(resource_id=api_id),
        ):
            with pytest.raises(Forbidden):
                invoke()

    get_api_key_list.assert_not_called()
