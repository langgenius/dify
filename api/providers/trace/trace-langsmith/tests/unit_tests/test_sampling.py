from concurrent.futures import ThreadPoolExecutor
from random import Random
from threading import Barrier
from unittest.mock import Mock
from uuid import UUID

import httpx
import pytest
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient
from pydantic import JsonValue

from tests.unit_tests.core.ops.test_provider_export import make_completed_trace

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize(
    ("langsmith", "langchain", "expected"),
    [
        (None, None, 1.0),
        ("", "0.25", 0.25),
        ("  ", "0.25", 0.25),
        ("0", "1", 0.0),
        (" 0.75 ", "0", 0.75),
        ("1", None, 1.0),
        ("NaN", None, 0.0),
    ],
)
def test_sampling_rate_keeps_sdk_namespace_precedence_and_number_semantics(
    langsmith: str | None, langchain: str | None, expected: float, monkeypatch: pytest.MonkeyPatch
) -> None:
    for namespace, value in (("LANGSMITH", langsmith), ("LANGCHAIN", langchain)):
        if value is not None:
            monkeypatch.setenv(f"{namespace}_TRACING_SAMPLING_RATE", value)
    assert LangSmithConfig.load_runtime_settings(make_provider_config())["sampling_rate"] == expected


@pytest.mark.parametrize("value", ["-0.1", "1.1", "inf", "-inf", "invalid"])
def test_sampling_rejects_invalid_rates(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_SAMPLING_RATE", value)
    with pytest.raises(ValueError):
        LangSmithConfig.load_runtime_settings(make_provider_config())


def test_zero_sampling_snapshot_skips_export_but_keeps_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    config = make_provider_config()
    monkeypatch.setenv("LANGSMITH_TRACING_SAMPLING_RATE", "0")
    snapshot = LangSmithConfig.load_runtime_settings(config)
    monkeypatch.setenv("LANGSMITH_TRACING_SAMPLING_RATE", "1")
    monkeypatch.setattr(LangSmithConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    trace = make_completed_trace()
    trace = trace.model_copy(
        update={"spans": tuple(span.model_copy(update={"started_at": None, "ended_at": None}) for span in trace.spans)}
    )
    receipts = []
    for _ in range(2):
        client = LangSmithTraceClient({**config, "_runtime_settings": snapshot})
        request = Mock(return_value=httpx.Response(200, json=[]))
        monkeypatch.setattr(client.http, "request", request)
        receipts.append(client.export_trace(trace))
        request.assert_not_called()
        assert all(receipt["sampled"] is False for receipt in receipts[-1].spans.values())
        assert client.verify_credentials()
        assert request.call_args.args == ("GET", "sessions")
    assert receipts[0] == receipts[1]


@pytest.mark.parametrize("external_id", [str(UUID(int=1)), str(UUID(int=2))])
def test_fractional_sampling_is_stable_across_retries_and_late_children(
    external_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_completed_trace()
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    original = trace.model_dump_json()
    sampled = Random(external_id).random() < 0.5  # noqa: S311 -- trace sampling is not a security decision
    config = {**make_provider_config(), "_runtime_settings": {"sampling_rate": 0.5}}
    receipts = []
    for _ in range(2):
        client = LangSmithTraceClient(config)
        request = Mock(return_value=httpx.Response(202))
        monkeypatch.setattr(client.http, "request", request)
        receipt = client.export_trace(trace)
        receipts.append(receipt)
        assert request.call_count == (1 if sampled else 0)
        assert all(parent["sampled"] is sampled for parent in receipt.spans.values())
    assert receipts[0] == receipts[1]
    assert trace.model_dump_json() == original

    late = make_completed_trace()
    late = late.model_copy(
        update={
            "source": late.source.model_copy(
                update={"tenant_id": trace.source.tenant_id, "app_id": trace.source.app_id}
            )
        }
    )
    # An attached operation inherits its parent's decision even if its own rate would disagree.
    child_client = LangSmithTraceClient(
        {**make_provider_config(), "_runtime_settings": {"sampling_rate": 0.0 if sampled else 1.0}}
    )
    request = Mock(return_value=httpx.Response(202))
    monkeypatch.setattr(child_client.http, "request", request)
    child_receipt = child_client.export_trace(late, receipts[0].spans[trace.root_span_id])
    assert request.call_count == (1 if sampled else 0)
    assert all(parent["sampled"] is sampled for parent in child_receipt.spans.values())
    assert all(parent["trace_id"] == external_id for parent in child_receipt.spans.values())


def test_legacy_parent_receipt_already_represents_a_sampled_trace(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_completed_trace()
    parent_id = str(UUID(int=1))
    parent: dict[str, JsonValue] = {
        "trace_id": parent_id,
        "span_id": parent_id,
        "dotted_order": "20260909T080000000000Z" + parent_id,
    }
    client = LangSmithTraceClient({**make_provider_config(), "_runtime_settings": {"sampling_rate": 0.0}})
    request = Mock(return_value=httpx.Response(202))
    monkeypatch.setattr(client.http, "request", request)
    receipt = client.export_trace(trace, parent)
    request.assert_called_once()
    assert all(span["sampled"] is True for span in receipt.spans.values())


def test_concurrent_tenants_keep_opposite_sampling_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    traces = [make_completed_trace(), make_completed_trace()]
    assert traces[0].source.tenant_id != traces[1].source.tenant_id
    clients = []
    requests = []
    for rate in (0, 1):
        config = make_provider_config(secret=f"tenant-{rate}-secret")
        monkeypatch.setenv("LANGSMITH_TRACING_SAMPLING_RATE", str(rate))
        snapshot = LangSmithConfig.load_runtime_settings(config)
        client = LangSmithTraceClient({**config, "_runtime_settings": snapshot})
        request = Mock(return_value=httpx.Response(202))
        monkeypatch.setattr(client.http, "request", request)
        clients.append(client)
        requests.append(request)
    barrier = Barrier(2)

    def export(index: int):
        barrier.wait(timeout=5)
        return clients[index].export_trace(traces[index])

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = list(executor.map(export, range(2)))
    requests[0].assert_not_called()
    requests[1].assert_called_once()
    for run in requests[1].call_args.kwargs["json"]["post"]:
        assert run["extra"]["metadata"]["dify.tenant_id"] == traces[1].source.tenant_id
    assert all(receipt["sampled"] is False for receipt in receipts[0].spans.values())
    assert all(receipt["sampled"] is True for receipt in receipts[1].spans.values())
