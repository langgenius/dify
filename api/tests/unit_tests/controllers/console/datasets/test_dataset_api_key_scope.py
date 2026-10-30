from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import cast
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask
from flask.testing import FlaskClient

from controllers.console import flask_admission, wraps
from controllers.console.datasets import datasets as controller
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import ApplicationServices
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from models.account import Account
from services.auth.api_key_contracts import ApiKeyRecord
from services.knowledge.api_key_service import DatasetApiKeyService


@dataclass
class AdmittedAccount:
    id: str
    role: TenantAccountRole
    status: str = "active"


@dataclass(frozen=True)
class ApiKeyRoutes:
    client: FlaskClient
    keys: Mock


@pytest.fixture
def api_key_routes(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    account_application_services: ApplicationServices,
) -> ApiKeyRoutes:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=True,
        RBAC_ENABLED=False,
    )
    keys = create_autospec(DatasetApiKeyService, instance=True, spec_set=True)
    services = replace(account_application_services, dataset_api_keys=keys)
    monkeypatch.setattr(controller, "application_services", lambda: services)

    account = AdmittedAccount(id="account-1", role=TenantAccountRole.OWNER)
    identity = AccountWithTenant(account=cast("Account", account), tenant_id="workspace-1")
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)

    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    api = ExternalApi(app)
    api.models.update(controller.console_ns.models)
    api.add_resource(controller.DatasetApiKeyApi, "/datasets/api-keys")
    return ApiKeyRoutes(app.test_client(), keys)


@pytest.mark.parametrize("dataset_ids", [False, "", 0, None, {}, "dataset-1", [123], [False]])
def test_invalid_scope_cannot_create_an_unrestricted_key(api_key_routes: ApiKeyRoutes, dataset_ids: object) -> None:
    response = api_key_routes.client.post("/datasets/api-keys", json={"dataset_ids": dataset_ids})

    assert response.status_code == 400
    assert response.json == {
        "code": "bad_request",
        "message": "dataset_ids must be a list of strings.",
        "status": 400,
    }
    api_key_routes.keys.create_workspace_key.assert_not_called()


@pytest.mark.parametrize("payload", [False, 0, "", []])
def test_invalid_payload_cannot_create_an_unrestricted_key(api_key_routes: ApiKeyRoutes, payload: object) -> None:
    response = api_key_routes.client.post("/datasets/api-keys", json=payload)

    assert response.status_code == 400
    api_key_routes.keys.create_workspace_key.assert_not_called()


def test_json_null_cannot_create_an_unrestricted_key(api_key_routes: ApiKeyRoutes) -> None:
    response = api_key_routes.client.post("/datasets/api-keys", data="null", content_type="application/json")

    assert response.status_code == 400
    api_key_routes.keys.create_workspace_key.assert_not_called()


def test_omitted_body_keeps_the_default_scope(api_key_routes: ApiKeyRoutes) -> None:
    api_key_routes.keys.create_workspace_key.return_value = ApiKeyRecord(
        id="key-1", type="dataset", token="dataset-secret"
    )

    response = api_key_routes.client.post("/datasets/api-keys")

    assert response.status_code == 200
    assert api_key_routes.keys.create_workspace_key.call_args.args[1] == ()


@pytest.mark.parametrize(
    ("payload", "scope"),
    [({}, ()), ({"dataset_ids": []}, ()), ({"dataset_ids": ["dataset-1"]}, ("dataset-1",))],
)
def test_valid_scope_is_preserved(
    api_key_routes: ApiKeyRoutes, payload: dict[str, object], scope: tuple[str, ...]
) -> None:
    api_key_routes.keys.create_workspace_key.return_value = ApiKeyRecord(
        id="key-1", type="dataset", token="dataset-secret", dataset_ids=scope
    )

    response = api_key_routes.client.post("/datasets/api-keys", json=payload)

    assert response.status_code == 200
    assert response.get_json()["dataset_ids"] == list(scope)
    api_key_routes.keys.create_workspace_key.assert_called_once()
    context, actual_scope = api_key_routes.keys.create_workspace_key.call_args.args
    assert context.active_workspace_id == "workspace-1"
    assert actual_scope == scope
