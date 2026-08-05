from __future__ import annotations

import inspect
from collections.abc import Callable
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.apikey import BaseApiKeyListResource, BaseApiKeyResource
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.enums import ApiTokenType
from models.model import ApiToken, App


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


def test_list_api_keys_uses_injected_session_and_tenant_id() -> None:
    resource = _make_list_resource()
    raw_get = cast(
        Callable[[BaseApiKeyListResource, object, str, str], dict[str, object]],
        inspect.unwrap(BaseApiKeyListResource.get),
    )
    session = MagicMock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace()
    api_key = SimpleNamespace(
        id="key-1",
        type=ApiTokenType.APP,
        token="app-token",
        last_used_at=None,
        created_at=None,
    )
    session.scalars.return_value.all.return_value = [api_key]

    result = raw_get(resource, session, "app-1", "tenant-1")

    session.execute.assert_called_once()
    session.scalars.assert_called_once()
    assert result == {
        "data": [
            {
                "id": "key-1",
                "type": "app",
                "token": "app-token",
                "last_used_at": None,
                "created_at": None,
            }
        ]
    }


def test_create_api_key_uses_injected_session_and_tenant_id() -> None:
    resource = _make_list_resource()
    raw_post = cast(
        Callable[[BaseApiKeyListResource, object, str, str], tuple[dict[str, object], int]],
        inspect.unwrap(BaseApiKeyListResource.post),
    )
    session = MagicMock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace()
    session.scalar.return_value = 0

    def add_api_token(api_token: ApiToken) -> None:
        api_token.id = "key-1"

    with patch(
        "controllers.console.apikey.ApiToken.generate_api_key", return_value="app-generated-token"
    ) as generate_api_key:
        session.add.side_effect = add_api_token

        result, status = raw_post(resource, session, "app-1", "tenant-1")

    assert status == 201
    assert result["token"] == "app-generated-token"
    api_token = session.add.call_args.args[0]
    assert api_token.app_id == "app-1"
    assert api_token.tenant_id == "tenant-1"
    assert api_token.type == ApiTokenType.APP
    generate_api_key.assert_called_once_with("app-", 24, session=session)
    session.execute.assert_called_once()
    session.scalar.assert_called_once()
    session.commit.assert_called_once()


def test_delete_api_key_rejects_non_admin_account() -> None:
    resource = _make_key_resource()
    raw_delete = cast(
        Callable[[BaseApiKeyResource, object, str, str, str, Account], tuple[str, int]],
        inspect.unwrap(BaseApiKeyResource.delete),
    )
    session = MagicMock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace()

    with pytest.raises(Forbidden):
        raw_delete(
            resource,
            session,
            "app-1",
            "key-1",
            "tenant-1",
            _make_account(TenantAccountRole.NORMAL),
        )

    session.execute.assert_called_once()
    session.scalar.assert_not_called()


def test_delete_api_key_uses_injected_session_user_and_tenant() -> None:
    resource = _make_key_resource()
    raw_delete = cast(
        Callable[[BaseApiKeyResource, object, str, str, str, Account], tuple[str, int]],
        inspect.unwrap(BaseApiKeyResource.delete),
    )
    api_key = SimpleNamespace(token="app-token", type=ApiTokenType.APP)
    session = MagicMock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace()
    session.scalar.return_value = api_key

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
    assert session.execute.call_count == 2
    session.scalar.assert_called_once()
    session.commit.assert_called_once()
    assert result == ""
    assert status == 204
