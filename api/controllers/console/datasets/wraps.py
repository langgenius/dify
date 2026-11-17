from collections.abc import Callable
from functools import wraps

from flask import current_app
from sqlalchemy.orm import Session

from controllers.console.datasets.error import PipelineNotFoundError
from libs.external_api import document_errors
from libs.login import current_account_with_tenant
from models.dataset import Pipeline
from services.rag_pipeline.rag_pipeline import RagPipelineService


def _scoped_session() -> Session:
    """Return the request-scoped session unmigrated handlers commit.

    Those handlers still read and commit through the application session, so the
    pipeline has to be loaded there. The factory is passed into the decorator;
    it is not a default argument on ``get_rag_pipeline_with``.
    """
    scoped = current_app.extensions["sqlalchemy"].session
    return scoped()


def load_rag_pipeline(session: Session, pipeline_id: str, *, tenant_id: str) -> Pipeline:
    """Load one pipeline through ``session`` for ``tenant_id``.

    Precondition: ``session`` is open, ``pipeline_id`` is the pipeline id, and
    ``tenant_id`` is the tenant that must own it.
    Postcondition: returns that pipeline. A missing pipeline, or one owned by
    another tenant, raises ``PipelineNotFoundError``. Nothing is written.
    """
    pipeline = RagPipelineService.get_pipeline_by_id(pipeline_id, tenant_id, session=session)
    if pipeline is None:
        raise PipelineNotFoundError()
    return pipeline


def _request_tenant_id() -> str:
    """Return the signed-in console tenant.

    Precondition: the request has an authenticated account with an active workspace.
    Postcondition: returns that tenant id.
    """
    return current_account_with_tenant().tenant_id


def _injected_session(args: tuple[object, ...]) -> Session | None:
    """Return the session ``with_session`` placed right after ``self``, or ``None``.

    ``with_session`` passes its session as the first argument after ``self``, so a
    handler that composes it directly above ``get_rag_pipeline`` reaches this decorator
    with ``args == (self, session, ...)``. Any other value in that slot, such as an
    ``Account`` from ``with_current_user``, means the handler has not migrated.
    """
    if len(args) < 2:
        return None
    candidate = args[1]
    if isinstance(candidate, Session):
        return candidate
    return None


def _pipeline_for_call(
    args: tuple[object, ...],
    pipeline_id: str,
    *,
    session_factory: Callable[[], Session],
    resolve_tenant_id: Callable[[], str],
) -> Pipeline:
    """Load the pipeline for one decorated call.

    Precondition: ``pipeline_id`` is present and ``resolve_tenant_id`` returns the
    signed-in tenant. An injected session, when present, is open.
    Postcondition: returns that tenant's pipeline. Nothing is written.
    """
    injected = _injected_session(args)
    session = injected if injected is not None else session_factory()
    return load_rag_pipeline(session, pipeline_id, tenant_id=resolve_tenant_id())


def get_rag_pipeline_with(
    *,
    session_factory: Callable[[], Session],
    resolve_tenant_id: Callable[[], str] = _request_tenant_id,
):
    """Build ``get_rag_pipeline`` with an explicit session factory and tenant resolver.

    Callers pass the session factory. Tests pass the factory that owns the fixture
    row. ``get_rag_pipeline`` passes ``_scoped_session`` for handlers that have not
    composed ``with_session`` yet.

    Precondition: ``session_factory`` returns an open session and
    ``resolve_tenant_id`` returns the signed-in tenant.
    Postcondition: returns a decorator that replaces ``pipeline_id`` with
    ``pipeline``. A missing ``pipeline_id`` raises ``ValueError``. A pipeline
    outside the tenant raises ``PipelineNotFoundError``. Nothing is written.
    """

    def decorator[**P, R](view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            if not kwargs.get("pipeline_id"):
                raise ValueError("missing pipeline_id in path parameters")

            pipeline_id = str(kwargs.get("pipeline_id"))
            del kwargs["pipeline_id"]
            kwargs["pipeline"] = _pipeline_for_call(
                args,
                pipeline_id,
                session_factory=session_factory,
                resolve_tenant_id=resolve_tenant_id,
            )
            return view(*args, **kwargs)

        return document_errors(decorated_view, PipelineNotFoundError)

    return decorator


def get_rag_pipeline[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Replace the ``pipeline_id`` path parameter with the tenant's ``Pipeline``.

    A handler that composes ``@with_session`` directly above this decorator loads
    the pipeline through that request session. A handler that has not migrated
    loads it through the application's scoped session, the same one those handlers
    later commit and the fallback this refactor removes once every caller injects.

    Precondition: ``pipeline_id`` is a keyword argument and a tenant is signed in.
    Postcondition: the view receives ``pipeline`` instead of ``pipeline_id``. A
    missing ``pipeline_id`` raises ``ValueError``. A pipeline outside the tenant
    raises ``PipelineNotFoundError``. Nothing is written.
    """

    @wraps(view)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
        if not kwargs.get("pipeline_id"):
            raise ValueError("missing pipeline_id in path parameters")

        pipeline_id = str(kwargs.get("pipeline_id"))
        del kwargs["pipeline_id"]
        kwargs["pipeline"] = _pipeline_for_call(
            args,
            pipeline_id,
            session_factory=_scoped_session,
            resolve_tenant_id=_request_tenant_id,
        )
        return view(*args, **kwargs)

    return document_errors(decorated_view, PipelineNotFoundError)
