"""Unit tests for @endpoint — the single decorator route handlers attach to.

Exercises decoration-time behaviour, plus one end-to-end check that the
composition produces the same wire behaviour as a hand-stacked route. The
auth and contract behaviour @endpoint composes from is otherwise covered by
test_router.py, test_pipelines.py and test_contract.py.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from flask import Flask
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from werkzeug.exceptions import UnprocessableEntity

from controllers.common.schema import register_response_schema_model, register_schema_model
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, endpoint, returns
from controllers.openapi.auth.requirements import CheckAppApiEnabled, TokenScope
from controllers.openapi.auth.router import subject_router
from controllers.openapi.auth.spec import EndpointSpec
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType
from models.account import Account, AccountStatus

ACCOUNT_ID = "10000000-0000-0000-0000-000000000001"
TOKEN_ID = "10000000-0000-0000-0000-000000000002"


def test_requirement_passed_as_class_fails_at_import():
    with pytest.raises(TypeError, match="requirements must be instances"):
        endpoint(requirements=(CheckAppApiEnabled,))


def test_handler_seam_is_exposed():
    @endpoint(requirements=(TokenScope(Scope.APPS_RUN),))
    def view(self, ctx): ...

    assert view.__handler__ is not None


def test_spec_attached_to_the_view_is_the_spec_the_router_runs(monkeypatch: pytest.MonkeyPatch):
    captured: list[EndpointSpec] = []
    original_guard = subject_router.guard

    def capturing_guard(spec: EndpointSpec):
        captured.append(spec)
        return original_guard(spec)

    monkeypatch.setattr(subject_router, "guard", capturing_guard)

    @endpoint(requirements=(TokenScope(Scope.APPS_RUN),))
    def view(self, ctx): ...

    assert len(captured) == 1
    assert view.__spec__ is captured[0]  # type: ignore[attr-defined]


def test_endpoint_requires_a_ctx_parameter():
    with pytest.raises(TypeError, match="ctx"):

        @endpoint(requirements=(TokenScope(Scope.APPS_RUN),))
        def view(self): ...


def test_edition_is_forwarded_to_the_spec():
    """`edition` isn't in the brief's Produces line, but `EndpointSpec` already
    carries it and apps_permitted_external.py needs it at migration (Task 11).
    """

    @endpoint(requirements=(), edition=frozenset({DeploymentEdition.ENTERPRISE}))
    def view(self, ctx): ...

    assert view.__spec__.edition == frozenset({DeploymentEdition.ENTERPRISE})


class _EndpointQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(1, ge=1)


class _EndpointResp(BaseModel):
    value: int


@pytest.fixture(autouse=True, scope="module")
def _register_endpoint_test_models():
    register_schema_model(openapi_ns, _EndpointQuery)
    register_response_schema_model(openapi_ns, _EndpointResp)
    yield
    openapi_ns.models.pop(_EndpointQuery.__name__, None)
    openapi_ns.models.pop(_EndpointResp.__name__, None)


def _account_token() -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email=None,
        subject_issuer=None,
        account_id=uuid.UUID(ACCOUNT_ID),
        client_id="openapi-client",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.UUID(TOKEN_ID),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
    )


def test_endpoint_matches_a_hand_stacked_route(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The central claim of this decorator: composing auth/accepts/returns
    internally produces the identical wire behaviour as stacking them by hand
    — `@subject_router.guard(spec)` / `@returns` / `@accepts` / def, today's
    convention (apps.py, account.py, workspaces.py).
    """
    account = Account(name="endpoint-test", email="endpoint-test@example.com", status=AccountStatus.ACTIVE)
    account.id = ACCOUNT_ID
    sqlite_session.add(account)
    sqlite_session.commit()

    token = _account_token()
    monkeypatch.setattr(
        "controllers.openapi.auth.router.get_authenticator",
        lambda: SimpleNamespace(authenticate=lambda _token: token),
    )
    monkeypatch.setattr("controllers.openapi.auth.pipelines._mount_flask_login", lambda _user: None)

    requirements = (TokenScope(Scope.FULL),)

    @endpoint(requirements=requirements, query=_EndpointQuery, returns=(200, _EndpointResp, "ok"))
    def composed(_self, ctx, *, query: _EndpointQuery):
        assert ctx is not None
        return _EndpointResp(value=query.page)

    @subject_router.guard(EndpointSpec(requirements=requirements))
    @returns(200, _EndpointResp, description="ok")
    @accepts(query=_EndpointQuery)
    def hand_stacked(_self, *, ctx, query: _EndpointQuery):
        assert ctx is not None
        return _EndpointResp(value=query.page)

    with app.test_request_context("/openapi/v1/endpoint-test?page=7", headers={"Authorization": "Bearer tok"}):
        composed_result = composed(SimpleNamespace())
    with app.test_request_context("/openapi/v1/endpoint-test?page=7", headers={"Authorization": "Bearer tok"}):
        hand_result = hand_stacked(SimpleNamespace())

    assert composed_result == hand_result == ({"value": 7}, 200)

    with app.test_request_context("/openapi/v1/endpoint-test?page=0", headers={"Authorization": "Bearer tok"}):
        with pytest.raises(UnprocessableEntity):
            composed(SimpleNamespace())
    with app.test_request_context("/openapi/v1/endpoint-test?page=0", headers={"Authorization": "Bearer tok"}):
        with pytest.raises(UnprocessableEntity):
            hand_stacked(SimpleNamespace())


def test_multiple_returns_reproduce_todays_stacked_responses():
    """`app_dsl.py:49-51` stacks three `@returns` on one route; `returns=`
    must reproduce the same set of documented responses — including the
    `"default"` error registration each layer redundantly re-adds today.
    """

    @returns(200, _EndpointResp, "ok200")
    @returns(202, _EndpointResp, "ok202")
    @returns(400, _EndpointResp, "ok400")
    def hand_stacked(): ...

    @endpoint(
        requirements=(),
        returns=((200, _EndpointResp, "ok200"), (202, _EndpointResp, "ok202"), (400, _EndpointResp, "ok400")),
    )
    def composed(self, ctx): ...

    hand_apidoc = hand_stacked.__apidoc__ if hasattr(hand_stacked, "__apidoc__") else {}
    composed_apidoc = composed.__apidoc__ if hasattr(composed, "__apidoc__") else {}
    hand_responses = hand_apidoc.get("responses", {})
    composed_responses = composed_apidoc.get("responses", {})
    assert set(composed_responses) == set(hand_responses) == {"200", "202", "400", "default"}
