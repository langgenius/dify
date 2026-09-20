from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any, ClassVar, override

from flask import current_app, request
from flask_login import user_logged_in
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.openapi._catalog import CATALOG_HEADER, catalog_for
from controllers.openapi._errors import CatalogStale
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller
from controllers.openapi.auth.requirements import (
    Rank,
    Requirement,
    ResolveCaller,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, reset_auth_ctx, set_auth_ctx
from models.account import Account
from models.model import EndUser

_PIPELINES: dict[type[Subject], Pipeline] = {}


class Pipeline:
    fixed: ClassVar[tuple[Requirement, ...]] = ()

    def __init_subclass__(cls, serves: type[Subject] | None = None, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        if serves is not None:
            _PIPELINES[serves] = cls()

    def run(
        self,
        *,
        subject: Subject,
        auth: AuthContext,
        spec: EndpointSpec,
        ctx: Context,
        session: Session,
        call: Callable[..., Any],
    ) -> Any:
        """Endpoint-declared requirements are merged ahead of the fixed ones,
        so a stable sort leaves them first at equal rank — which is what keeps
        `CheckSubject` ahead of `_RequiresEnterprise`.
        """
        for requirement in sorted(spec.requirements + self.fixed, key=lambda item: item.rank):
            requirement.run(subject, ctx, session)
        with mounted(subject, auth, ctx):
            return call(ctx=ctx)


def pipeline_for_subject(subject: Subject) -> Pipeline:
    return _PIPELINES[type(subject)]


class _RequiresCurrentCatalog(Requirement):
    """The client names the catalog it built the request from, and a request
    built from any other catalog - or from none - is refused before a handler
    runs, so a tampered or stale local copy can never pick the route. Fixed on
    every pipeline rather than declared per route, so no endpoint can leave it
    out; `_catalog` and `_version` are unguarded and stay reachable to recover.
    """

    rank = Rank.FIRST

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        _, fingerprint = catalog_for(current_app._get_current_object())  # type: ignore[attr-defined]
        if request.headers.get(CATALOG_HEADER) != fingerprint:
            raise CatalogStale()


class AccountPipeline(Pipeline, serves=AccountSubject):
    fixed = (_RequiresCurrentCatalog(), ResolveCaller())


class _RequiresEnterprise(Requirement):
    """A gate on the token kind, not on a route, so no endpoint declares it.
    It runs after `authenticate` on purpose: a `dfoe_` string no row backs
    answers 401 like any bad bearer, so the edition cannot be probed. The
    licence is the router's, checked before any bearer is read.
    """

    rank = Rank.FIRST

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            raise Forbidden("external_sso_requires_ee")


class ExternalSsoPipeline(Pipeline, serves=ExternalSsoSubject):
    fixed = (
        _RequiresCurrentCatalog(),
        _RequiresEnterprise(),
        ResolveCaller(),
    )


@contextmanager
def mounted(subject: Subject, auth: AuthContext, ctx: Context) -> Generator[None]:
    user = load_caller(ctx) if subject.mounts_caller(ctx) else None
    reset_token = set_auth_ctx(auth)
    try:
        if user is not None:
            _mount_flask_login(user)
        yield
    finally:
        reset_auth_ctx(reset_token)


def _mount_flask_login(user: Account | EndUser) -> None:
    current_app.login_manager._update_request_context_with_user(user)  # type: ignore[attr-defined]
    user_logged_in.send(current_app._get_current_object(), user=user)  # type: ignore[attr-defined]
