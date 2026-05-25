"""Workspace role gate.

Layered on top of `validate_bearer` + `accept_subjects(SubjectType.ACCOUNT)`
for routes whose access depends on the caller's `TenantAccountJoin.role`
in the workspace named by the `workspace_id` path parameter.

Usage::

    @openapi_ns.route("/workspaces/<string:workspace_id>/members")
    class Members(Resource):
        @validate_bearer(accept=ACCEPT_USER_ANY)
        @accept_subjects(SubjectType.ACCOUNT)
        @require_workspace_role()  # any member
        def get(self, workspace_id: str): ...

        @validate_bearer(accept=ACCEPT_USER_ANY)
        @accept_subjects(SubjectType.ACCOUNT)
        @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
        def post(self, workspace_id: str): ...

Non-member callers get 404 (matching `GET /openapi/v1/workspaces/<id>`)
so workspace IDs do not leak across tenants. A member without one of the
allowed roles gets 403.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import TypeVar

from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

from extensions.ext_database import db
from libs.oauth_bearer import try_get_auth_ctx
from models import TenantAccountJoin
from models.account import TenantAccountRole

F = TypeVar("F", bound=Callable[..., object])


def require_workspace_role(*allowed_roles: TenantAccountRole) -> Callable[[F], F]:
    """Gate a route on the caller's role in ``workspace_id``.

    Pass no roles to require only membership. Pass one or more roles to
    require the caller's role be in that set.
    """

    allowed = frozenset(allowed_roles)

    def deco(fn: F) -> F:
        @wraps(fn)
        def wrapper(*args: object, **kwargs: object) -> object:
            ctx = try_get_auth_ctx()
            if ctx is None or ctx.account_id is None:
                raise RuntimeError(
                    "require_workspace_role called without account-bearer context; "
                    "stack validate_bearer + accept_subjects(SubjectType.ACCOUNT) above it"
                )

            workspace_id = kwargs.get("workspace_id")
            if not workspace_id:
                raise RuntimeError(
                    "require_workspace_role expects a 'workspace_id' route parameter"
                )

            join = db.session.execute(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == str(workspace_id),
                    TenantAccountJoin.account_id == str(ctx.account_id),
                )
            ).scalar_one_or_none()

            if join is None:
                raise NotFound("workspace not found")

            if allowed and TenantAccountRole(join.role) not in allowed:
                raise Forbidden("insufficient workspace role")

            return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return deco
