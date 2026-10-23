from types import ModuleType

from flask import Blueprint
from flask_restx import Namespace

from controllers.common.access_response import register_auth_error_response
from controllers.common.errors import (
    InternalServerError,
    InvalidArgumentError,
    NotFoundError,
    UnauthorizedError,
    register_permission_error_handler,
)
from libs.external_api import ExternalApi

bp = Blueprint("service_api", __name__, url_prefix="/v1")
register_auth_error_response(bp, www_authenticate='Bearer realm="api"')

api = ExternalApi(
    bp,
    version="1.0",
    title="Service API",
    description="API for application services",
    register_default_root=False,
)
register_permission_error_handler(api)
# ``invalid_param`` is what the surface's ValueError handler already emits on any operation;
# ``not_found``, ``unauthorized`` and ``internal_server_error`` are the codes Werkzeug's own
# exceptions already produce on every operation.
api.document_generic_errors(InvalidArgumentError, NotFoundError, UnauthorizedError, InternalServerError)

service_api_ns = Namespace("service_api", description="Service operations", path="/")


def _register_controllers() -> tuple[ModuleType, ...]:
    """Load route modules after their namespaces and schema models exist."""

    from . import index
    from .app import (
        annotation,
        app,
        audio,
        completion,
        conversation,
        file,
        file_preview,
        human_input_form,
        message,
        site,
        workflow,
        workflow_events,
    )
    from .appdeploy import knowledge
    from .dataset import (
        dataset,
        document,
        hit_testing,
        metadata,
        segment,
    )
    from .dataset.rag_pipeline import rag_pipeline_workflow
    from .end_user import end_user
    from .workspace import models

    return (
        index,
        knowledge,
        annotation,
        app,
        audio,
        completion,
        conversation,
        file,
        file_preview,
        human_input_form,
        message,
        site,
        workflow,
        workflow_events,
        dataset,
        document,
        hit_testing,
        metadata,
        segment,
        rag_pipeline_workflow,
        end_user,
        models,
    )


(
    index,
    knowledge,
    annotation,
    app,
    audio,
    completion,
    conversation,
    file,
    file_preview,
    human_input_form,
    message,
    site,
    workflow,
    workflow_events,
    dataset,
    document,
    hit_testing,
    metadata,
    segment,
    rag_pipeline_workflow,
    end_user,
    models,
) = _register_controllers()

__all__ = [
    "annotation",
    "app",
    "audio",
    "completion",
    "conversation",
    "dataset",
    "document",
    "end_user",
    "file",
    "file_preview",
    "hit_testing",
    "human_input_form",
    "index",
    "knowledge",
    "message",
    "metadata",
    "models",
    "rag_pipeline_workflow",
    "segment",
    "site",
    "workflow",
    "workflow_events",
]

api.add_namespace(service_api_ns)
