from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

studio_bp = Blueprint("studio", __name__, url_prefix="/studio/api")

studio_api = ExternalApi(
    studio_bp,
    version="1.0",
    title="Studio API",
    description="Studio APIs for app management and workflow editing",
)

studio_ns = Namespace("studio", description="Studio API operations", path="/")
