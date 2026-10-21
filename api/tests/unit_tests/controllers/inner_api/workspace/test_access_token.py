from collections.abc import Callable
from dataclasses import dataclass, field
from inspect import unwrap
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


@dataclass
class _Tokens:
    """Records enterprise token calls; ``create_result`` is returned, or raised when it is an exception."""

    create_result: ResourceAccessTokenCreateResult | Exception = field(
        default_factory=lambda: ResourceAccessTokenCreateResult(str(TOKEN_ID), "sk-secret", ())
    )
    created: list[dict[str, object]] = field(default_factory=list)
    deleted: list[dict[str, object]] = field(default_factory=list)

    def create_for_enterprise(self, **kwargs: object) -> ResourceAccessTokenCreateResult:
        self.created.append(kwargs)
        if isinstance(self.create_result, Exception):
            raise self.create_result
        return self.create_result

    def delete_for_enterprise(self, **kwargs: object) -> None:
        self.deleted.append(kwargs)


@dataclass
class _Services:
    resource_access_tokens: _Tokens


@pytest.fixture
def tokens(monkeypatch: pytest.MonkeyPatch) -> _Tokens:
    service = _Tokens()
    monkeypatch.setattr(controller, "application_services", lambda: _Services(resource_access_tokens=service))
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


def test_create_forwards_a_managed_token_and_returns_the_secret_once(app: Flask, tokens: _Tokens) -> None:
    result = _create(app, _appdeploy_payload())

    assert result == ({"id": str(TOKEN_ID), "token": "sk-secret"}, 201)
    assert tokens.created == [
        {
            "tenant_id": TENANT_ID,
            "managed_by": ResourceAccessTokenManagedBy.APPDEPLOY,
            "name": "appdeploy",
            "created_by": None,
            "resources": (ResourceAccessTokenResource(ResourceAccessTokenResourceType.KNOWLEDGE, DATASET_ID),),
        }
    ]


@pytest.mark.parametrize(
    "payload",
    [
        {**_appdeploy_payload(), "resources": []},
        {**_appdeploy_payload(), "resources": [{"type": "knowledge", "id": "not-a-uuid"}]},
        {**_appdeploy_payload(), "managed_by": "plugin"},
    ],
)
def test_create_rejects_malformed_payload_before_the_service(
    app: Flask, tokens: _Tokens, payload: dict[str, object]
) -> None:
    with pytest.raises(controller.InvalidAccessTokenRequestError):
        _create(app, payload)
    assert tokens.created == []


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
def test_create_maps_service_errors(app: Flask, tokens: _Tokens, error: Exception, expected: type[Exception]) -> None:
    tokens.create_result = error
    with pytest.raises(expected, match=str(error)):
        _create(app, _appdeploy_payload())


def test_delete_is_scoped_to_the_tenant(app: Flask, tokens: _Tokens) -> None:
    with app.test_request_context(f"/?tenant_id={TENANT_ID}", method="DELETE"):
        result = unwrap(controller.EnterpriseAccessTokenApi.delete)(controller.EnterpriseAccessTokenApi(), TOKEN_ID)

    assert result == {"message": "access token deleted."}
    assert tokens.deleted == [{"tenant_id": TENANT_ID, "token_id": str(TOKEN_ID)}]


def test_delete_requires_tenant_id(app: Flask, tokens: _Tokens) -> None:
    with app.test_request_context(method="DELETE"), pytest.raises(controller.InvalidAccessTokenRequestError):
        unwrap(controller.EnterpriseAccessTokenApi.delete)(controller.EnterpriseAccessTokenApi(), TOKEN_ID)
    assert tokens.deleted == []


def test_create_requires_inner_api_key(app: Flask, tokens: _Tokens, config_overrides: Callable[..., None]) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="secret", DEPLOYMENT_EDITION="CLOUD")
    with app.test_request_context(method="POST", json=_appdeploy_payload()):
        with pytest.raises(InnerApiUnauthorizedError):
            controller.EnterpriseAccessTokenListApi().post()
    assert tokens.created == []
