from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("service_api", __name__, url_prefix="/v1")

api = ExternalApi(
    bp,
    version="1.0",
    title="Service API",
    description="API for application services",
    doc="/docs",  # Enable Swagger UI at /v1/docs
)

service_api_ns = Namespace("service_api", description="Service operations", path="/")

from . import index  # pyright: ignore[reportUnusedImport]
from .app import (
    annotation,  # pyright: ignore[reportUnusedImport]
    app,  # pyright: ignore[reportUnusedImport]
    audio,  # pyright: ignore[reportUnusedImport]
    completion,  # pyright: ignore[reportUnusedImport]
    conversation,  # pyright: ignore[reportUnusedImport]
    file,  # pyright: ignore[reportUnusedImport]
    file_preview,  # pyright: ignore[reportUnusedImport]
    message,  # pyright: ignore[reportUnusedImport]
    site,  # pyright: ignore[reportUnusedImport]
    workflow,  # pyright: ignore[reportUnusedImport]
)
from .dataset import (
    dataset,  # pyright: ignore[reportUnusedImport]
    document,  # pyright: ignore[reportUnusedImport]
    hit_testing,  # pyright: ignore[reportUnusedImport]
    metadata,  # pyright: ignore[reportUnusedImport]
    segment,  # pyright: ignore[reportUnusedImport]
    upload_file,  # pyright: ignore[reportUnusedImport]
)
from .workspace import models  # pyright: ignore[reportUnusedImport]

api.add_namespace(service_api_ns)
