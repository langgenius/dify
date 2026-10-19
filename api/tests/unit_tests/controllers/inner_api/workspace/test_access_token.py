from collections.abc import Callable
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import pytest
from flask import Flask

from constants.resource_access_token import ResourceAccessTokenManagedBy, ResourceAccessTokenResourceType
from controllers.inner_api.workspace import access_token as controller
from controllers.inner_api.wraps import InnerApiUnauthorizedError
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenCreateResult,
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenNotFoundError,
    ResourceAccessTokenResource,
)

TENANT_ID = "0dd1d570-cf7b-4bab-9c7f-84ebe6c36985"
DATASET_ID = "5b3a1c2e-7f64-4c1d-9e0a-2f8b6d4c3a10"
TOKEN_ID = UUID("9e8f7a6b-5c4d-4e3f-8a2b-1c0d9e8f7a6b")


@pytest.fixture
def tokens(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = Mock()
    monkeypatch.setattr(controller, "application_services", lambda: SimpleNamespace(resource_access_tokens=service))
    return service


def _create(app: Flask, payload: dict[str, object]) -> object:
    with app.test_request_context(method="POST", json=payload):
        return unwrap(controller.EnterpriseAccessTokenListApi.post)(controller.EnterpriseAccessTokenListApi())


def _appdeploy_payload() -> dict[str, object]:
    return {
        "tenant_id": TENANT_ID.upper(),
        "managed_by": "appdeploy",
        "name": "appdeploy",
        "resources": [{"type": "knowledge", "id": DATASET_ID}],
    }


def test_create_forwards_a_managed_token_and_returns_the_secret_once(app: Flask, tokens: Mock) -> None:
    tokens.create_for_enterprise.return_value = ResourceAccessTokenCreateResult(str(TOKEN_ID), "sk-secret", ())

    result = _create(app, _appdeploy_payload())

    assert result == ({"id": str(TOKEN_ID), "token": "sk-secret"}, 201)
    tokens.create_for_enterprise.assert_called_once_with(
        tenant_id=TENANT_ID,
        managed_by=ResourceAccessTokenManagedBy.APPDEPLOY,
        name="appdeploy",
        created_by=None,
        resources=(ResourceAccessTokenResource(ResourceAccessTokenResourceType.KNOWLEDGE, DATASET_ID),),
    )


@pytest.mark.parametrize(
    "payload",
    [
        {**_appdeploy_payload(), "resources": []},
        {**_appdeploy_payload(), "resources": [{"type": "knowledge", "id": "not-a-uuid"}]},
        {**_appdeploy_payload(), "managed_by": "plugin"},
    ],
)
def test_create_rejects_malformed_payload_before_the_service(
    app: Flask, tokens: Mock, payload: dict[str, object]
) -> None:
    with pytest.raises(controller.InvalidAccessTokenRequestError):
        _create(app, payload)
    tokens.create_for_enterprise.assert_not_called()


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (ResourceAccessTokenInputError("created_by is required"), controller.InvalidAccessTokenRequestError),
        (ResourceAccessTokenNotFoundError("Knowledge base x not found."), controller.AccessTokenResourceNotFoundError),
        (
            ResourceAccessTokenForbiddenError("App API access is not enabled."),
            controller.AccessTokenResourceUnavailableError,
        ),
    ],
)
def test_create_maps_service_errors(app: Flask, tokens: Mock, error: Exception, expected: type[Exception]) -> None:
    tokens.create_for_enterprise.side_effect = error
    with pytest.raises(expected, match=str(error)):
        _create(app, _appdeploy_payload())


def test_delete_is_scoped_to_the_tenant(app: Flask, tokens: Mock) -> None:
    with app.test_request_context(f"/?tenant_id={TENANT_ID}", method="DELETE"):
        result = unwrap(controller.EnterpriseAccessTokenApi.delete)(controller.EnterpriseAccessTokenApi(), TOKEN_ID)

    assert result == {"message": "access token deleted."}
    tokens.delete_for_enterprise.assert_called_once_with(tenant_id=TENANT_ID, token_id=str(TOKEN_ID))


def test_delete_requires_tenant_id(app: Flask, tokens: Mock) -> None:
    with app.test_request_context(method="DELETE"), pytest.raises(controller.InvalidAccessTokenRequestError):
        unwrap(controller.EnterpriseAccessTokenApi.delete)(controller.EnterpriseAccessTokenApi(), TOKEN_ID)
    tokens.delete_for_enterprise.assert_not_called()


def test_create_requires_inner_api_key(app: Flask, tokens: Mock, config_overrides: Callable[..., None]) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="secret", DEPLOYMENT_EDITION="CLOUD")
    with app.test_request_context(method="POST", json=_appdeploy_payload()):
        with pytest.raises(InnerApiUnauthorizedError):
            controller.EnterpriseAccessTokenListApi().post()
    tokens.create_for_enterprise.assert_not_called()
