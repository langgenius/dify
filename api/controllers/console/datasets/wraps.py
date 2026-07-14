from collections.abc import Callable
from functools import wraps

from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console.datasets.error import PipelineNotFoundError
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.dataset import Pipeline


def load_rag_pipeline(session: Session, pipeline_id: str) -> Pipeline:
    _, current_tenant_id = current_account_with_tenant()
    pipeline = session.scalar(
        select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == current_tenant_id).limit(1)
    )
    if not pipeline:
        raise PipelineNotFoundError()
    return pipeline


def get_rag_pipeline[**P, R](view_func: Callable[P, R]) -> Callable[P, R]:
    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
        if not kwargs.get("pipeline_id"):
            raise ValueError("missing pipeline_id in path parameters")

        pipeline_id = kwargs.get("pipeline_id")
        pipeline_id = str(pipeline_id)

        del kwargs["pipeline_id"]
        kwargs["pipeline"] = load_rag_pipeline(db.session(), pipeline_id)

        return view_func(*args, **kwargs)

    return decorated_view
