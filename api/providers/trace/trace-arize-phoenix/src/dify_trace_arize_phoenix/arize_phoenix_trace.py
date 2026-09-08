"""Arize and Phoenix export the same complete OpenInference/OTLP span tree."""

from typing import Any
from urllib.parse import quote

from core.ops.otlp_trace import OtlpTraceClient
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig


def create_trace_client(provider_name: str, provider_config: dict[str, Any]) -> OtlpTraceClient:
    config = (ArizeConfig if provider_name == "arize" else PhoenixConfig).model_validate(provider_config)
    headers = {"authorization": f"Bearer {config.api_key}"} if config.api_key else {}
    resource_attributes = {
        "openinference.project.name": config.project or "default",
        "model_id": config.project or "default",
    }
    if isinstance(config, ArizeConfig):
        headers.update({"api_key": config.api_key or "", "space_id": config.space_id or ""})
        project_url = f"https://app.arize.com/organizations/{quote(config.space_id or '', safe='')}/models"
    else:
        headers["api_key"] = config.api_key or ""
        project_url = config.endpoint.rstrip("/") + "/projects/"
    endpoint = config.endpoint.rstrip("/")
    if not endpoint.endswith("/v1/traces"):
        endpoint += "/v1/traces"
    return OtlpTraceClient(endpoint, headers, resource_attributes, project_url)
