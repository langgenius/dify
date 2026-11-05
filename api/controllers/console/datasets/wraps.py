from collections.abc import Callable
from functools import wraps

from sqlalchemy.orm import Session

from controllers.console.datasets.error import PipelineNotFoundError
from extensions.ext_database import db
from libs.external_api import document_errors
from libs.login import current_account_with_tenant
from models.dataset import Pipeline
from services.rag_pipeline.rag_pipeline import RagPipelineService


def load_rag_pipeline(session: Session, pipeline_id: str) -> Pipeline:
    _, current_tenant_id = current_account_with_tenant()
    pipeline = RagPipelineService.get_pipeline_by_id(pipeline_id, current_tenant_id, session=session)
    if not pipeline:
        raise PipelineNotFoundError()
    return pipeline


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


def get_rag_pipeline[**P, R](view_func: Callable[P, R]) -> Callable[P, R]:
    """Replace the ``pipeline_id`` path parameter with the tenant's ``Pipeline``.

    Handlers may compose ``@with_session`` directly above this decorator so the pipeline
    loads through the same request session the handler uses. Handlers that have not
    migrated keep loading it through ``db.session``.

    Precondition: ``pipeline_id`` is a keyword argument and a tenant is signed in.
    Postcondition: the view receives ``pipeline`` instead of ``pipeline_id``. A missing
    ``pipeline_id`` raises ``ValueError``; a pipeline outside the tenant raises
    ``PipelineNotFoundError``. Nothing is written.
    """

    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
        if not kwargs.get("pipeline_id"):
            raise ValueError("missing pipeline_id in path parameters")

        pipeline_id = kwargs.get("pipeline_id")
        pipeline_id = str(pipeline_id)

        del kwargs["pipeline_id"]
        session = _injected_session(args)
        kwargs["pipeline"] = load_rag_pipeline(db.session() if session is None else session, pipeline_id)

        return view_func(*args, **kwargs)

    return document_errors(decorated_view, PipelineNotFoundError)
