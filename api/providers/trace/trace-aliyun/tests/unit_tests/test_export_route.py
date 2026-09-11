"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

import pytest

from core.ops.provider_export import (
    create_provider_client,
)
from tests.unit_tests.core.ops.test_provider_export import provider_config


@pytest.mark.parametrize(
    ("endpoint", "trace_path"),
    [
        ("https://log.aliyuncs.com", "api/v1/traces"),
        ("https://project.cn-heyuan.log.aliyuncs.com", "api/v1/traces"),
        ("https://PROJECT.LOG.ALIYUNCS.COM:443", "api/v1/traces"),
        ("https://evillog.aliyuncs.com", "api/otlp/traces"),
        ("https://log.aliyuncs.com.evil.example", "api/otlp/traces"),
        ("https://evil.example/log.aliyuncs.com", "api/otlp/traces"),
        ("https://evil.example/?host=log.aliyuncs.com", "api/otlp/traces"),
    ],
)
def test_aliyun_trace_path_matches_complete_hostname(endpoint: str, trace_path: str) -> None:
    client = create_provider_client("aliyun", {**provider_config("aliyun"), "endpoint": endpoint})

    assert client.http.endpoint.endswith(f"/adapt_tenant-secret/{trace_path}")
