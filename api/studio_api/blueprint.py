from flask import Blueprint

from controllers.common.app_namespace import app_ns
from libs.external_api import ExternalApi

studio_bp = Blueprint("studio", __name__, url_prefix="/studio/api")

studio_api = ExternalApi(
    studio_bp,
    version="1.0",
    title="Studio API",
    description="Studio APIs for app management and workflow editing",
)

# app_ns is the shared namespace — routes registered on it are served by
# both the studio blueprint (/studio/api/) and the console blueprint
# (/console/api/) when added to their respective APIs.

# Kept for backwards compatibility — existing imports of studio_ns still work.
studio_ns = app_ns
