"""Surface gate.

`@accept_subjects(...)` is the route-level form. `SurfaceCheck` (pipeline
step) is the pipeline-level form. Both delegate to `check_surface` so the
audit emit + canonical-path message are single-sourced.

Subjects come from `libs.oauth_bearer.SubjectType` directly — no parallel
vocabulary. Caller hits the wrong surface → 403 ``wrong_surface`` + audit
``openapi.wrong_surface_denied``.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import TypeVar

from flask import request
from werkzeug.exceptions import Forbidden

from controllers.openapi._audit import emit_wrong_surface
from libs.oauth_bearer import SubjectType, try_get_auth_ctx

_CANONICAL_PATH: dict[SubjectType, str] = {
    SubjectType.ACCOUNT: "/openapi/v1/apps",
    SubjectType.EXTERNAL_SSO: "/openapi/v1/permitted-external-apps",
}

F = TypeVar("F", bound=Callable[..., object])


def check_surface(accepted: frozenset[SubjectType]) -> None:
    """Enforce that the resolved subject is in ``accepted``.

    Reads the openapi auth ContextVar via :func:`try_get_auth_ctx`. Raises
    ``Forbidden`` with ``wrong_surface`` + canonical-path hint on miss;
    emits ``openapi.wrong_surface_denied`` audit. If no auth context is
    set the bearer layer didn't run — that's a wiring bug, not a
    user-driven failure, so surface it as a ``RuntimeError`` instead of
    a silent 403.
    """
    ctx = try_get_auth_ctx()
    if ctx is None:
        raise RuntimeError(
            "check_surface called without an auth context; stack validate_bearer or BearerCheck above the surface gate"
        )

    subject = _coerce_subject_type(getattr(ctx, "subject_type", None))
    if subject in accepted:
        return

    canonical = _CANONICAL_PATH.get(subject, "/openapi/v1/") if subject else "/openapi/v1/"
    emit_wrong_surface(
        subject_type=subject.value if subject else None,
        attempted_path=request.path,
        client_id=getattr(ctx, "client_id", None),
        token_id=_stringify(getattr(ctx, "token_id", None)),
    )
    raise Forbidden(description=f"wrong_surface (canonical: {canonical})")


def accept_subjects(*accepted: SubjectType) -> Callable[[F], F]:
    accepted_set: frozenset[SubjectType] = frozenset(accepted)

    def deco(fn: F) -> F:
        @wraps(fn)
        def wrapper(*args: object, **kwargs: object) -> object:
            check_surface(accepted_set)
            return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return deco


def _coerce_subject_type(raw: object) -> SubjectType | None:
    if raw is None:
        return None
    if isinstance(raw, SubjectType):
        return raw
    if isinstance(raw, str):
        return SubjectType(raw)
    return None


def _stringify(value: object) -> str | None:
    if value is None:
        return None
    return str(value)
