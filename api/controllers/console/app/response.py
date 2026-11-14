"""Render Console App records at the HTTP boundary."""

from dataclasses import asdict

from flask import request

from configs import dify_config
from fields.app_fields import AppDetailWithSite
from libs.url_utils import normalize_api_base_url
from services.entities.app_entities import AppRecord


def app_detail_response(app: AppRecord) -> AppDetailWithSite:
    """Resolve transport URLs here so repositories work without a Flask request."""
    data = asdict(app)
    data["api_base_url"] = normalize_api_base_url(dify_config.SERVICE_API_URL or request.host_url.rstrip("/"))
    data["app_id"] = None
    if data["site"] is not None:
        data["site"]["app_base_url"] = dify_config.APP_WEB_URL or request.url_root.rstrip("/")
    return AppDetailWithSite.model_validate(data)
