from __future__ import annotations

import inspect
from collections.abc import Callable
from types import CodeType, SimpleNamespace
from typing import Protocol, cast
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console import flask_admission
from controllers.console import resource_access_token as controller
from libs.login import AccountWithTenant
from models.account import TenantAccountRole
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account

_ENDPOINTS = [
    controller.ResourceAccessTokenListApi.get,
    controller.ResourceAccessTokenListApi.post,
    controller.ResourceAccessTokenApi.patch,
    controller.ResourceAccessTokenRelationApi.delete,
]


class _WrappedEndpoint(Protocol):
    __code__: CodeType
    __wrapped__: _WrappedEndpoint


def _admission_injector(method: Callable[..., object]) -> Callable[..., object]:
    current = cast(_WrappedEndpoint, method)
    while "inject_request_context" not in current.__code__.co_qualname:
        current = current.__wrapped__
    return cast(Callable[..., object], current)


def _admit_as(monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole) -> None:
    account = make_account(name="Test User", email="user@example.com", role=role)
    account.id = "account-1"
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="tenant-1"),
    )


@pytest.mark.parametrize("method", _ENDPOINTS)
def test_endpoints_declare_owner_only_admission(method: Callable[..., object]) -> None:
    allowed_roles = inspect.getclosurevars(_admission_injector(method)).nonlocals["allowed_roles"]
    assert allowed_roles == frozenset({TenantAccountRole.OWNER})


@pytest.mark.parametrize("method", _ENDPOINTS)
@pytest.mark.parametrize("role", [TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.NORMAL])
def test_endpoints_reject_non_owner(
    monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], role: TenantAccountRole
) -> None:
    _admit_as(monkeypatch, role)
    with Flask(__name__).test_request_context(), pytest.raises(Forbidden):
        _admission_injector(method)(None)


def test_owner_is_admitted_with_request_context(monkeypatch: pytest.MonkeyPatch) -> None:
    _admit_as(monkeypatch, TenantAccountRole.OWNER)
    tokens = MagicMock()
    monkeypatch.setattr(controller, "application_services", lambda: SimpleNamespace(resource_access_tokens=tokens))
    injector = _admission_injector(controller.ResourceAccessTokenRelationApi.delete)
    token_id, relation_id = uuid4(), uuid4()

    with Flask(__name__).test_request_context():
        result = injector(controller.ResourceAccessTokenRelationApi(), token_id=token_id, relation_id=relation_id)

    assert result == ("", 204)
    context = tokens.delete_relation.call_args.args[0]
    assert (context.account_id, context.active_workspace_id) == ("account-1", "tenant-1")
    tokens.delete_relation.assert_called_once_with(context, token_id=str(token_id), relation_id=str(relation_id))


@pytest.mark.parametrize(
    ("error", "status"),
    [
        ("input", 400),
        ("forbidden", 403),
        ("missing", 404),
        ("invalid", 401),
    ],
)
def test_service_failures_keep_the_http_error_contract(error: str, status: int) -> None:
    from werkzeug.exceptions import HTTPException

    from controllers.common.resource_access_token_errors import resource_access_token_errors
    from services.auth.resource_access_token_contracts import (
        ResourceAccessTokenForbiddenError,
        ResourceAccessTokenInputError,
        ResourceAccessTokenInvalidError,
        ResourceAccessTokenNotFoundError,
    )

    errors = {
        "input": ResourceAccessTokenInputError,
        "forbidden": ResourceAccessTokenForbiddenError,
        "missing": ResourceAccessTokenNotFoundError,
        "invalid": ResourceAccessTokenInvalidError,
    }
    with pytest.raises(HTTPException) as raised:
        with resource_access_token_errors():
            raise errors[error]("original message")
    assert raised.value.code == status
    assert raised.value.description == "original message"
