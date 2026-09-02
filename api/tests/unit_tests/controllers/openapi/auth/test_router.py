from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import NoReturn
from unittest.mock import MagicMock

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

import libs.rate_limit as rate_limit_module
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import CheckAppApiEnabled, Requirement
from controllers.openapi.auth.router import subject_router
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject
from enums import DeploymentEdition
from libs.oauth_bearer import (
    AuthContext,
    BearerAuthenticator,
    OAuthAccessTokenResolver,
    Resolver,
    TokenType,
)
from models import Account
from models.oauth import OAuthAccessToken
from services.entities.feature_entities import (
    LicenseStatus,
)

from ._world import (
    ACCOUNT_ID,
    APP_ID,
    TOKEN_ID,
    make_account,
    make_app,
    make_auth,
    persist,
    system_features,
)

ROUTER = "controllers.openapi.auth.router"
FEATURES = "controllers.openapi.auth.requirements.FeatureService.get_system_features"
MOUNT = "controllers.openapi.auth.pipelines._mount_flask_login"
ENTERPRISE_ONLY = frozenset({DeploymentEdition.ENTERPRISE})


def never_reached(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("reached a step the router should have answered before")


def _authenticates(monkeypatch: pytest.MonkeyPatch, auth: AuthContext) -> None:
    authenticator = SimpleNamespace(authenticate=lambda _token: auth)
    monkeypatch.setattr(f"{ROUTER}.get_authenticator", lambda: authenticator)


def _guard(
    view: Callable[..., object],
    *,
    requirements: tuple[Requirement, ...] = (),
    edition: frozenset[DeploymentEdition] | None = None,
    write: bool = True,
) -> Callable[..., object]:
    return subject_router.guard(EndpointSpec(requirements=requirements, edition=edition, write=write))(view)


def _nothing(**_kwargs: object) -> None:
    return None


def test_endpoint_edition_gate_404s_before_the_bearer_is_read(
    app: Flask,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(f"{ROUTER}.extract_bearer", never_reached)
    view = _guard(_nothing, edition=ENTERPRISE_ONLY)

    with app.test_request_context("/openapi/v1/permitted-external-apps"):
        with pytest.raises(NotFound):
            view()


def test_a_dead_licence_403s_an_unauthenticated_caller_on_an_ee_endpoint(
    app: Flask,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The endpoint licence check fires before `extract_bearer`, so a caller
    with no bearer at all sees 403, not 401.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(FEATURES, lambda: system_features(license_status=LicenseStatus.EXPIRED))
    view = _guard(_nothing, edition=ENTERPRISE_ONLY)

    with app.test_request_context("/openapi/v1/permitted-external-apps"):
        with pytest.raises(Forbidden, match="license_invalid"):
            view()


INVALID_BEARER = "invalid bearer"
"""The one answer the router gives a bearer it will not accept.

`InvalidBearerError` is a plain `Exception`, so uncaught at this seam it reaches
`errorhandler(Exception)` and answers 500 — telling a caller whose token expired
that the server broke, when difyctl maps only 401/403 to re-authenticate. Every
rejection reason shares this one message: a caller that can tell them apart can
probe which tokens ever existed, the same reasoning as the 404-not-403 elsewhere
on this surface.
"""


def _resolver_never_asked() -> MagicMock:
    """An unknown prefix is refused by the registry, before any resolver runs."""
    resolver = MagicMock()
    resolver.resolve.side_effect = AssertionError("an unknown prefix must not reach a resolver")
    return resolver


def _resolver_with_no_live_row() -> MagicMock:
    """`None` is what the shipped resolver answers for a token with no usable row —
    never minted, revoked, or minted under the other variant's prefix.
    """
    resolver = MagicMock()
    resolver.resolve.return_value = None
    return resolver


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, object] = {}

    def get(self, key: str) -> object | None:
        return self.store.get(key)

    def setex(self, key: str, _ttl: int, value: object) -> None:
        self.store[key] = value

    def delete(self, key: str) -> None:
        self.store.pop(key, None)


class _OneRowSession:
    """Enough `Session` for `_TokenTypeResolver` to read one row and expire it.

    SQLite hands `expires_at` back naive while the resolver compares it against
    an aware `now`, so the expiry branch cannot be driven through the real
    sqlite fixture — same reason `test_auth_matrix._MemoryResolver` exists.
    """

    def __init__(self, row: OAuthAccessToken) -> None:
        self._row = row
        self.updates: list[object] = []

    def query(self, _model: object) -> _OneRowSession:
        return self

    def filter(self, *_criteria: object) -> _OneRowSession:
        return self

    def one_or_none(self) -> OAuthAccessToken:
        return self._row

    def execute(self, statement: object) -> SimpleNamespace:
        self.updates.append(statement)
        return SimpleNamespace(rowcount=1)

    def commit(self) -> None:
        return None


def _expired_row() -> OAuthAccessToken:
    """Live in every respect but its expiry, so expiry is the only refusal."""
    row = OAuthAccessToken(
        subject_email="account@example.com",
        client_id="openapi-client",
        device_label="laptop",
        prefix=TokenType.OAUTH_ACCOUNT.prefix,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
        subject_issuer="dify:account",
        account_id=ACCOUNT_ID,
        token_hash="deadbeef",
    )
    row.id = TOKEN_ID
    return row


def _expired_resolver() -> tuple[Resolver, _OneRowSession]:
    session = _OneRowSession(_expired_row())
    resolver = OAuthAccessTokenResolver(lambda: session, _FakeRedis())
    return resolver.for_token_type(TokenType.OAUTH_ACCOUNT), session


def _resolver_for_an_expired_row() -> Resolver:
    """The shipped resolver, over a row whose expiry has passed."""
    resolver, _ = _expired_resolver()
    return resolver


def _authenticates_for_real(
    monkeypatch: pytest.MonkeyPatch, resolver: Resolver, *, token_type: TokenType = TokenType.OAUTH_ACCOUNT
) -> None:
    """The real `BearerAuthenticator`, so the refusals are its own, not a stub's."""
    monkeypatch.setattr(
        rate_limit_module,
        "LIMIT_BEARER_PER_TOKEN",
        rate_limit_module.RateLimit(
            0,
            rate_limit_module.LIMIT_BEARER_PER_TOKEN.window,
            rate_limit_module.LIMIT_BEARER_PER_TOKEN.scopes,
        ),
    )
    authenticator = BearerAuthenticator({token_type: resolver})
    monkeypatch.setattr(f"{ROUTER}.get_authenticator", lambda: authenticator)


def _refuse(app: Flask, token: str) -> Unauthorized:
    view = _guard(_nothing)
    with app.test_request_context("/openapi/v1/account", headers={"Authorization": f"Bearer {token}"}):
        with pytest.raises(Unauthorized) as raised:
            view()
    return raised.value


@pytest.mark.parametrize(
    ("resolver_factory", "token"),
    [
        (_resolver_never_asked, "zzz_notatokenkind"),
        (_resolver_with_no_live_row, f"{TokenType.OAUTH_ACCOUNT.prefix}revoked"),
        (_resolver_for_an_expired_row, f"{TokenType.OAUTH_ACCOUNT.prefix}stale"),
    ],
    ids=["unknown prefix", "no live row", "expired"],
)
def test_every_way_authenticate_rejects_a_bearer_answers_the_same_401(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    resolver_factory: Callable[[], Resolver],
    token: str,
) -> None:
    _authenticates_for_real(monkeypatch, resolver_factory())

    refusal = _refuse(app, token)

    assert (refusal.code, refusal.description) == (401, INVALID_BEARER)


def test_the_expired_branch_hard_expires_the_row_before_refusing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Pins that the `expired` row above really took the expiry branch, rather
    than reaching the same answer as a token that was never minted.
    """
    resolver, session = _expired_resolver()
    _authenticates_for_real(monkeypatch, resolver)

    _refuse(app, f"{TokenType.OAUTH_ACCOUNT.prefix}stale")

    assert len(session.updates) == 1


def test_an_account_token_reaches_the_view_with_a_resolved_context(
    app: Flask,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persist(sqlite_session, make_account())
    _authenticates(monkeypatch, make_auth(TokenType.OAUTH_ACCOUNT))
    mounted: list[object] = []
    monkeypatch.setattr(MOUNT, mounted.append)
    seen: dict[str, object] = {}

    def handler(resource: str, *, ctx: Context) -> str:
        seen.update(resource=resource, ctx=ctx)
        return "answered"

    view = _guard(handler)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        result = view("self")

    assert result == "answered"
    assert isinstance(seen["ctx"], Context)
    assert isinstance(seen["ctx"].subject, AccountSubject)
    assert seen["resource"] == "self"
    assert [type(user) for user in mounted] == [Account]


def test_path_params_reach_the_context(
    app: Flask,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`CheckAppApiEnabled` reads its `app_id` off the context, so it only fires
    when the router has put the route's path params there.
    """
    persist(sqlite_session, make_app(enable_api=False))
    _authenticates(monkeypatch, make_auth(TokenType.OAUTH_ACCOUNT))
    view = _guard(_nothing, requirements=(CheckAppApiEnabled(),))

    with app.test_request_context(f"/openapi/v1/apps/{APP_ID}", headers={"Authorization": "Bearer tok"}):
        request.view_args = {"app_id": APP_ID}
        with pytest.raises(Forbidden, match="service_api_disabled"):
            view()


def _rename_handler(*, ctx: Context) -> str:
    ctx.caller.name = "renamed"
    return "ok"


def test_write_true_by_default_commits_a_mutation_on_success(
    app: Flask,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persist(sqlite_session, make_account())
    _authenticates(monkeypatch, make_auth(TokenType.OAUTH_ACCOUNT))
    monkeypatch.setattr(MOUNT, lambda _user: None)
    view = _guard(_rename_handler)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        view()

    with sqlite_session_factory() as verify:
        assert verify.get(Account, ACCOUNT_ID).name == "renamed"


def test_write_false_does_not_persist_a_mutation(
    app: Flask,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persist(sqlite_session, make_account())
    _authenticates(monkeypatch, make_auth(TokenType.OAUTH_ACCOUNT))
    monkeypatch.setattr(MOUNT, lambda _user: None)
    view = _guard(_rename_handler, write=False)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        view()

    with sqlite_session_factory() as verify:
        assert verify.get(Account, ACCOUNT_ID).name == "OpenAPI account"
