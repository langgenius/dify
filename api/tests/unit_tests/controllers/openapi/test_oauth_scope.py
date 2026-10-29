"""A browser login's OAuth scopes against each op's effect, through the real routes."""

from dataclasses import replace
from http import HTTPStatus
from types import SimpleNamespace

import pytest
from werkzeug.test import TestResponse

from constants.oauth_bearer import OAuthScope
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

READ_ONLY = frozenset({OAuthScope.READ})


def _grant(monkeypatch: pytest.MonkeyPatch, world: AdmittedWorld, oauth_scopes: frozenset[OAuthScope] | None) -> None:
    auth = replace(world.auth, oauth_scopes=oauth_scopes)
    monkeypatch.setattr(
        "controllers.openapi.auth.router.get_authenticator",
        lambda: SimpleNamespace(authenticate=lambda _token: auth),
    )


def _call(world: AdmittedWorld, method: str, path: str) -> TestResponse:
    url = "/openapi/v1" + path.format(workspace_id=world.workspace_id, member_id=world.member_id)
    return world.client.open(url, method=method, headers=world.headers, json={})


def test_a_read_only_login_runs_a_read_op(admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch) -> None:
    _grant(monkeypatch, admitted_bearer, READ_ONLY)

    assert _call(admitted_bearer, "GET", "/workspaces/{workspace_id}").status_code == HTTPStatus.OK


@pytest.mark.parametrize(
    ("method", "path"),
    [
        pytest.param("POST", "/workspaces/{workspace_id}/members", id="write"),
        pytest.param("DELETE", "/workspaces/{workspace_id}/members/{member_id}", id="destructive"),
    ],
)
def test_a_read_only_login_is_refused_a_changing_op_with_the_scope_it_needs(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch, method: str, path: str
) -> None:
    _grant(monkeypatch, admitted_bearer, READ_ONLY)

    response = _call(admitted_bearer, method, path)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "insufficient_scope"
    assert response.headers["WWW-Authenticate"] == 'Bearer error="insufficient_scope", scope="write"'


def test_an_effect_override_decides_over_the_http_method(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`check.console_app.dsl` is a POST that only reads, so a read-only login gets past the guard to the body check."""
    _grant(monkeypatch, admitted_bearer, READ_ONLY)

    response = _call(admitted_bearer, "POST", "/workspaces/{workspace_id}/apps/imports:check")

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


@pytest.mark.parametrize(
    "oauth_scopes",
    [None, frozenset(OAuthScope)],
    ids=["unrestricted-device-login", "read-write"],
)
def test_a_login_that_may_write_gets_past_the_guard(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch, oauth_scopes: frozenset[OAuthScope] | None
) -> None:
    _grant(monkeypatch, admitted_bearer, oauth_scopes)

    response = _call(admitted_bearer, "POST", "/workspaces/{workspace_id}/members")

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
