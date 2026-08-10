from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console.apikey import BaseApiKeyListResource, BaseApiKeyResource
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
    session.commit()

    result = raw_get(resource, session, "app-1", "tenant-1")
    data = cast(list[dict[str, object]], result["data"])

    assert len(data) == 1
    assert data[0]["id"] == "key-1"
    assert data[0]["token"] == "app-token"


def test_create_api_key_uses_injected_session_and_tenant_id(sqlite_session: Session) -> None:
    resource = _make_list_resource()
    raw_post = cast(
        Callable[[BaseApiKeyListResource, object, str, str], tuple[dict[str, object], int]],
        inspect.unwrap(BaseApiKeyListResource.post),
    )
    session = sqlite_session
    _persist_app(session)
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
    api_key = ApiToken(type=ApiTokenType.APP, token="app-token", app_id="app-1", tenant_id="tenant-1")
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
