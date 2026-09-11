"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

from concurrent.futures import ThreadPoolExecutor
from typing import Unpack

import httpx
import pytest

from core.ops.provider_export import (
    export_trace,
)
from tests.unit_tests.core.ops.test_provider_export import (
    RequestArguments,
    make_completed_trace,
    provider_config,
    settings_for,
)


def test_overlapping_exports_keep_credentials_and_parent_order_separate(monkeypatch: pytest.MonkeyPatch) -> None:
    from threading import Barrier

    barrier = Barrier(2)
    sent: list[RequestArguments] = []

    def request(_method: str, _url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        if not any(item["headers"]["x-api-key"] == kwargs["headers"]["x-api-key"] for item in sent):
            barrier.wait(timeout=5)
        sent.append(kwargs)
        return httpx.Response(202, json={})

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace_a, trace_b = make_completed_trace(), make_completed_trace()
    with ThreadPoolExecutor(2) as pool:
        jobs = [
            pool.submit(export_trace, trace, settings_for(trace, "langsmith"), provider_config("langsmith", key))
            for trace, key in ((trace_a, "secret-a"), (trace_b, "secret-b"))
        ]
        assert all(len(job.result().spans) == 3 for job in jobs)
    for request in sent:
        expected_tenant = (
            trace_a.source.tenant_id if request["headers"]["x-api-key"] == "secret-a" else trace_b.source.tenant_id
        )
        posted = request["json"]["post"]
        assert isinstance(posted, list)
        assert isinstance(posted[0], dict)
        extra = posted[0]["extra"]
        assert isinstance(extra, dict)
        metadata = extra["metadata"]
        assert isinstance(metadata, dict)
        assert metadata["dify.tenant_id"] == expected_tenant
