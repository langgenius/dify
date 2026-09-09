from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Unauthorized

from controllers.openapi import flask_admission
from controllers.openapi.auth.data import AuthData
from enums import DeploymentEdition
from libs.oauth_bearer import Scope, TokenType
from libs.rate_limit import LIMIT_ME_PER_ACCOUNT
from machinery.context import AccountRequestContext
from models.account import Account, AccountStatus


def _auth_data(*, status: AccountStatus = AccountStatus.ACTIVE) -> AuthData:
    account = Account(name="Ada", email="ada@example.com", status=status)
    account.id = "11111111-1111-1111-1111-111111111111"
    return AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=UUID(account.id),
        token_hash="hash-1",
        token_id=UUID("22222222-2222-2222-2222-222222222222"),
        scopes=frozenset({Scope.FULL}),
        caller=account,
    )


def _install_fake_transport(
    monkeypatch: pytest.MonkeyPatch,
    auth_data: AuthData,
    captured: dict[str, object],
) -> None:
    def guard(**requirements: object) -> Callable[[Callable[..., object]], Callable[..., object]]:
        captured.update(requirements)

        def decorator(view: Callable[..., object]) -> Callable[..., object]:
            @wraps(view)
            def admitted(*args: object, **kwargs: object) -> object:
                return view(*args, auth_data=auth_data, **kwargs)

            return admitted

        return decorator

    monkeypatch.setattr(flask_admission.auth_router, "guard", guard)


def test_admission_builds_stable_request_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    limited: list[tuple[object, str]] = []
    _install_fake_transport(monkeypatch, _auth_data(), captured)
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request-1")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: "trace-1")
    monkeypatch.setattr(flask_admission, "enforce", lambda spec, *, key: limited.append((spec, key)))

    @flask_admission.openapi_account_admission(
        scope=Scope.FULL,
        editions=frozenset({DeploymentEdition.ENTERPRISE}),
        rate_limit=LIMIT_ME_PER_ACCOUNT,
    )
    def view(_self: object, context: AccountRequestContext) -> AccountRequestContext:
        return context

    with Flask(__name__).test_request_context("/openapi/v1/account"):
        context = view(object())

    assert context == AccountRequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="11111111-1111-1111-1111-111111111111",
        access_token_id="22222222-2222-2222-2222-222222222222",
    )
    assert captured == {
        "scope": Scope.FULL,
        "allowed_token_types": frozenset({TokenType.OAUTH_ACCOUNT}),
        "edition": frozenset({DeploymentEdition.ENTERPRISE}),
        "require_valid_enterprise_license": True,
    }
    assert limited == [(LIMIT_ME_PER_ACCOUNT, "account:11111111-1111-1111-1111-111111111111")]


def test_admission_rejects_uninitialized_account(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_transport(monkeypatch, _auth_data(status=AccountStatus.UNINITIALIZED), {})

    @flask_admission.openapi_account_admission(scope=Scope.FULL)
    def view(_self: object, _context: AccountRequestContext) -> None:
        raise AssertionError("view must not run")

    with Flask(__name__).test_request_context("/openapi/v1/account"):
        with pytest.raises(Unauthorized, match="account not initialized"):
            view(object())


def test_admission_rejects_missing_auth_data(monkeypatch: pytest.MonkeyPatch) -> None:
    def guard(**_requirements: object) -> Callable[[Callable[..., object]], Callable[..., object]]:
        def decorator(view: Callable[..., object]) -> Callable[..., object]:
            return view

        return decorator

    monkeypatch.setattr(flask_admission.auth_router, "guard", guard)

    @flask_admission.openapi_account_admission(scope=Scope.FULL)
    def view(_self: object, _context: AccountRequestContext) -> None:
        raise AssertionError("view must not run")

    with Flask(__name__).test_request_context("/openapi/v1/account"):
        with pytest.raises(RuntimeError, match="did not provide valid AuthData"):
            view(object())
