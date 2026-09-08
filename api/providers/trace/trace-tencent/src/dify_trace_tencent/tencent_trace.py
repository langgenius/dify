"""Tencent's configured OTLP/gRPC endpoint receives spans and delta metrics synchronously."""

from typing import Any

from core.ops.otlp_trace import OtlpTraceClient
from dify_trace_tencent.config import TencentConfig


def create_trace_client(provider_config: dict[str, Any]) -> OtlpTraceClient:
    config = TencentConfig.model_validate(provider_config)
    return OtlpTraceClient(
        config.endpoint,
        {"authorization": f"Bearer {config.token}"},
        {"service.name": config.service_name},
        "https://console.cloud.tencent.com/apm",
        protocol="grpc",
        tencent_metrics=True,
    )
