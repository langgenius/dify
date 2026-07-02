from __future__ import annotations

import inspect
from collections.abc import Callable
from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.apikey import (
    BaseApiKeyListResource,
    BaseApiKeyResource,
    DatasetApiKeyListResource,
    build_masked_api_key_list,
    mask_api_token,
)
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.dataset import Dataset
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


def test_mask_api_token_reveals_only_a_fragment() -> None:
    # full secret must never be reproducible from the masked value
    masked = mask_api_token("dataset-mqxAkpML14jRmgsb6Z7DBnVq")
    assert masked == "datas...BnVq"
    assert "mqxAkpML" not in masked
    # very short tokens are fully hidden
    assert mask_api_token("short") == "***"


def test_build_masked_api_key_list_masks_every_token() -> None:
    keys = [
        SimpleNamespace(
            id="key-1",
            type=ApiTokenType.DATASET,
            token="dataset-aaaabbbbccccdddd",
            dataset_id="ds-1",
            last_used_at=None,
            created_at=None,
        ),
    ]
    # SimpleNamespace stands in for ApiToken rows (read via from_attributes)
    result = build_masked_api_key_list(cast("list[ApiToken]", keys))
    assert result.data[0].token == "datas...dddd"
    assert result.data[0].dataset_id == "ds-1"


def test_list_api_keys_uses_injected_tenant_id() -> None:
    resource = _make_list_resource()
    api_key = SimpleNamespace(
        id="key-1",
        type=ApiTokenType.APP,
        token="app-1234567890abcdef",
        last_used_at=None,
        created_at=None,
    )

    with (
        patch("controllers.console.apikey._get_resource") as get_resource,
        patch("controllers.console.apikey.db") as db_mock,
    ):
        db_mock.session.scalars.return_value.all.return_value = [api_key]

        result = resource.get("app-1", "tenant-1")

    get_resource.assert_called_once_with("app-1", "tenant-1", App)
    assert result == {
        "data": [
            {
                "id": "key-1",
                # reveal-once: the list never returns the full secret, only a masked fragment
                "type": "app",
                "token": "app-1...cdef",
                "dataset_id": None,
                "last_used_at": None,
                "created_at": None,
            }
        ]
    }


def test_create_api_key_uses_injected_tenant_id() -> None:
    resource = _make_list_resource()
    raw_post = cast(
        Callable[[BaseApiKeyListResource, str, str], tuple[dict[str, object], int]],
        inspect.unwrap(BaseApiKeyListResource.post),
    )

    def add_api_token(api_token: ApiToken) -> None:
        api_token.id = "key-1"

    with (
        patch("controllers.console.apikey._get_resource") as get_resource,
        patch("controllers.console.apikey.db") as db_mock,
        patch("controllers.console.apikey.ApiToken.generate_api_key", return_value="app-generated-token"),
    ):
        db_mock.session.scalar.return_value = 0
        db_mock.session.add.side_effect = add_api_token

        result, status = raw_post(resource, "app-1", "tenant-1")

    get_resource.assert_called_once_with("app-1", "tenant-1", App)
    assert status == 201
    assert result["token"] == "app-generated-token"
    api_token = db_mock.session.add.call_args.args[0]
    assert api_token.app_id == "app-1"
    assert api_token.tenant_id == "tenant-1"
    assert api_token.type == ApiTokenType.APP
    db_mock.session.commit.assert_called_once()


def test_create_dataset_api_key_binds_dataset_id() -> None:
    """Creating a key on the per-dataset route must bind it to that dataset (ApiToken.dataset_id)."""
    resource = DatasetApiKeyListResource()

    def add_api_token(api_token: ApiToken) -> None:
        api_token.id = "key-1"

    with (
        patch("controllers.console.apikey._get_resource") as get_resource,
        patch("controllers.console.apikey.db") as db_mock,
        patch("controllers.console.apikey.ApiToken.generate_api_key", return_value="dataset-generated-token"),
    ):
        db_mock.session.scalar.return_value = 0
        db_mock.session.add.side_effect = add_api_token

        api_token = resource._create_api_key("dataset-1", "tenant-1")

    get_resource.assert_called_once_with("dataset-1", "tenant-1", Dataset)
    assert api_token.dataset_id == "dataset-1"
    assert api_token.tenant_id == "tenant-1"
    assert api_token.type == ApiTokenType.DATASET
    db_mock.session.commit.assert_called_once()


def test_dataset_api_key_list_includes_workspace_scoped_keys() -> None:
    """The per-dataset key list shows everything that can reach the dataset:
    keys bound to it plus the tenant's workspace-scoped (NULL dataset_id) keys."""
    resource = DatasetApiKeyListResource()

    with (
        patch("controllers.console.apikey._get_resource"),
        patch("controllers.console.apikey.db") as db_mock,
    ):
        db_mock.session.scalars.return_value.all.return_value = []
        resource._get_api_key_list("dataset-1", "tenant-1")

    query_sql = str(db_mock.session.scalars.call_args.args[0])
    assert "dataset_id IS NULL" in query_sql


def test_delete_api_key_rejects_non_admin_account() -> None:
    resource = _make_key_resource()

    with (
        patch("controllers.console.apikey._get_resource") as get_resource,
        patch("controllers.console.apikey.db") as db_mock,
    ):
        with pytest.raises(Forbidden):
            resource.delete("app-1", "key-1", "tenant-1", _make_account(TenantAccountRole.NORMAL))

    get_resource.assert_called_once_with("app-1", "tenant-1", App)
    db_mock.session.scalar.assert_not_called()


def test_delete_api_key_uses_injected_user_and_tenant() -> None:
    resource = _make_key_resource()
    api_key = SimpleNamespace(token="app-token", type=ApiTokenType.APP)

    with (
        patch("controllers.console.apikey._get_resource") as get_resource,
        patch("controllers.console.apikey.db") as db_mock,
        patch("controllers.console.apikey.ApiTokenCache.delete") as delete_cache,
    ):
        db_mock.session.scalar.return_value = api_key

        result, status = resource.delete("app-1", "key-1", "tenant-1", _make_account(TenantAccountRole.OWNER))

    get_resource.assert_called_once_with("app-1", "tenant-1", App)
    delete_cache.assert_called_once_with("app-token", ApiTokenType.APP)
    db_mock.session.execute.assert_called_once()
    db_mock.session.commit.assert_called_once()
    assert result == ""
    assert status == 204
