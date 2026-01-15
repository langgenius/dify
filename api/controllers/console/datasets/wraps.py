from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from controllers.console.datasets.error import PipelineNotFoundError
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.dataset import Pipeline

P = ParamSpec("P")
R = TypeVar("R")


def get_rag_pipeline(view_func: Callable[P, R]):
    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs):
        if not kwargs.get("pipeline_id"):
            raise ValueError("missing pipeline_id in path parameters")

        _, current_tenant_id = current_account_with_tenant()

        pipeline_id = kwargs.get("pipeline_id")
        pipeline_id = str(pipeline_id)

        del kwargs["pipeline_id"]

        pipeline = (
            db.session.query(Pipeline)
            .where(Pipeline.id == pipeline_id, Pipeline.tenant_id == current_tenant_id)
            .first()
        )

        if not pipeline:
            raise PipelineNotFoundError()

        kwargs["pipeline"] = pipeline

        return view_func(*args, **kwargs)

    return decorated_view
