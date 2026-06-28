from collections.abc import Callable
from functools import wraps

from sqlalchemy import select
from werkzeug.exceptions import Forbidden

from controllers.console.datasets.error import PipelineNotFoundError
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.dataset import Pipeline
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError


def get_rag_pipeline[**P, R](view_func: Callable[P, R]) -> Callable[P, R]:
    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
        if not kwargs.get("pipeline_id"):
            raise ValueError("missing pipeline_id in path parameters")

        current_account, current_tenant_id = current_account_with_tenant()

        pipeline_id = kwargs.get("pipeline_id")
        pipeline_id = str(pipeline_id)

        del kwargs["pipeline_id"]

        pipeline = db.session.scalar(
            select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == current_tenant_id).limit(1)
        )

        if not pipeline:
            raise PipelineNotFoundError()

        dataset = pipeline.retrieve_dataset(db.session)
        if not dataset:
            raise PipelineNotFoundError()

        try:
            DatasetService.check_dataset_permission(dataset, current_account, db.session)
        except NoPermissionError as e:
            raise Forbidden(str(e))

        kwargs["pipeline"] = pipeline

        return view_func(*args, **kwargs)

    return decorated_view
