"""Per-subject auth pipelines.

A pipeline owns everything after the router has resolved a subject: the fixed
requirements every route of that subject gets, the merge with the endpoint's
own, and the mount. The whole abstraction is one tuple and a stable sort.
"""

from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any, ClassVar

from flask import current_app
from flask_login import user_logged_in
from sqlalchemy.orm import Session

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckAppWorkspaceMembership,
    EditionCheck,
    LicenseCheck,
    Requirement,
    ResolveCaller,
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
        `SubjectCheck` ahead of `EditionCheck` and `LicenseCheck`.
        """
        for requirement in sorted(spec.requirements + self.fixed, key=lambda item: item.rank):
            requirement.run(subject, ctx, session)
        with mounted(auth, ctx):
            return call(ctx=ctx)


class AccountPipeline(Pipeline):
    fixed = (CheckAppApiEnabled(), CheckAppWorkspaceMembership(), ResolveCaller())


class ExternalSsoPipeline(Pipeline):
    fixed = (
        EditionCheck(frozenset({DeploymentEdition.ENTERPRISE})),
        LicenseCheck(),
        CheckAppApiEnabled(),
        ResolveCaller(),
    )


@contextmanager
def mounted(auth: AuthContext, ctx: Context) -> Generator[None]:
    """Effects, not policy: the identity ContextVar is published for every
    subject, but flask-login is mounted only for a subject `ResolveCaller`
    resolved a caller for — the `mounts_caller` policy is consulted there, once.

    `ResolveCaller` is a requirement, so the caller is resolved *before*
    `set_auth_ctx`, because resolution raises on a token that outlived its
    account. Raising after the ContextVar is set would strand the identity
    there, and `libs/rate_limit` buckets on it.
    """
    user = ctx.caller if ctx.caller_loaded else None
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
