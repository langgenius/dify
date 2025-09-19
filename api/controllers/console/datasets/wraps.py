from collections.abc import Callable
from functools import wraps

from controllers.console.datasets.error import PipelineNotFoundError
from extensions.ext_database import db
from libs.login import current_user
from models.account import Account
from models.dataset import Pipeline


def get_rag_pipeline(
    view: Callable | None = None,
):
    def decorator(view_func):
        @wraps(view_func)
        def decorated_view(*args, **kwargs):
            if not kwargs.get("pipeline_id"):
                raise ValueError("missing pipeline_id in path parameters")

            if not isinstance(current_user, Account):
                raise ValueError("current_user is not an account")

            pipeline_id = kwargs.get("pipeline_id")
            pipeline_id = str(pipeline_id)

            del kwargs["pipeline_id"]

            pipeline = (
                db.session.query(Pipeline)
                .where(Pipeline.id == pipeline_id, Pipeline.tenant_id == current_user.current_tenant_id)
                .first()
            )

            if not pipeline:
                raise PipelineNotFoundError()

            kwargs["pipeline"] = pipeline

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)
