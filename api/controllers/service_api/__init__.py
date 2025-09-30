from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("service_api", __name__, url_prefix="/v1")

api = ExternalApi(
    bp,
    version="1.0",
    title="Service API",
    description="API for application services",
)

service_api_ns = Namespace("service_api", description="Service operations", path="/")

from . import index
from .app import (
    annotation,
    app,
    audio,
    completion,
    conversation,
    file,
    file_preview,
    message,
    site,
    workflow,
)
from .dataset import (
    dataset,
    document,
    hit_testing,
    metadata,
    segment,
)
from .workspace import models

__all__ = [
    "annotation",
    "app",
    "audio",
    "completion",
    "conversation",
    "dataset",
    "document",
    "file",
    "file_preview",
    "hit_testing",
    "index",
    "message",
    "metadata",
    "models",
    "segment",
    "site",
    "workflow",
]

api.add_namespace(service_api_ns)
