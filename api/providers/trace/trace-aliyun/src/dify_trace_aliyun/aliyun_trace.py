"""Aliyun receives every captured span directly, including nested agent operations."""

from typing import Any
from urllib.parse import quote, urljoin, urlsplit

from core.ops.otlp_trace import OtlpTraceClient
from dify_trace_aliyun.config import AliyunConfig


def create_trace_client(provider_config: dict[str, Any]) -> OtlpTraceClient:
    config = AliyunConfig.model_validate(provider_config)
    hostname = urlsplit(config.endpoint).hostname or ""
    path = (
        "api/v1/traces"
        if hostname == "log.aliyuncs.com" or hostname.endswith(".log.aliyuncs.com")
        else "api/otlp/traces"
    )
    endpoint = urljoin(config.endpoint, f"adapt_{quote(config.license_key, safe='')}/{path}")
    return OtlpTraceClient(
        endpoint,
        {},
        {"service.name": config.app_name, "acs.arms.service.feature": "genai_app"},
        "https://arms.console.aliyun.com/",
    )
