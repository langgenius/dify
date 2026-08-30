from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any, ClassVar, override

from flask import current_app
from flask_login import user_logged_in
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller
from controllers.openapi.auth.requirements import (
    Rank,
    Requirement,
    ResolveCaller,
    assert_license_valid,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, reset_auth_ctx, set_auth_ctx
from models.account import Account
from models.model import EndUser


class Pipeline:
    fixed: ClassVar[tuple[Requirement, ...]] = ()

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
        `SubjectCheck` ahead of `_RequiresEnterprise`.
        """
        for requirement in sorted(spec.requirements + self.fixed, key=lambda item: item.rank):
            requirement.run(subject, ctx, session)
        with mounted(subject, auth, ctx):
            return call(ctx=ctx)


class AccountPipeline(Pipeline):
    fixed = (ResolveCaller(),)


class _RequiresEnterprise(Requirement):
    """A gate on the token kind, not on a route, so no endpoint declares it and
    it stays private to this module.

    Its rank puts it behind the route's own `SubjectCheck` at the same band, so
    a token the route never accepted is refused as the wrong subject rather than
    the wrong edition — and the wrong-surface audit still fires. Edition before
    licence, mirroring the router's endpoint-level gate.
    """

    rank = Rank.FIRST

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            raise Forbidden("external_sso_requires_ee")
        assert_license_valid()


class ExternalSsoPipeline(Pipeline):
    fixed = (
        _RequiresEnterprise(),
        ResolveCaller(),
    )


@contextmanager
def mounted(subject: Subject, auth: AuthContext, ctx: Context) -> Generator[None]:
    """Effects, not policy: the identity ContextVar is published for every
    subject, but flask-login is mounted only for a subject whose own
    `mounts_caller` says so. Reading whatever `ctx.caller` happens to hold would
    mount what a membership check resolved, which is the same answer today and
    would stop being one for a subject that declines conditionally.

    `ResolveCaller` is a requirement, so the caller is resolved *before*
    `set_auth_ctx`, because resolution raises on a token that outlived its
    account. Raising after the ContextVar is set would strand the identity
    there, and `libs/rate_limit` buckets on it.
    """
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
