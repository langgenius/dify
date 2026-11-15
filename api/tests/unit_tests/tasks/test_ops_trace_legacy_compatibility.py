"""Exercise delivered old tasks with real owned storage, SQL and Native export."""

import io
import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from celery.app.task import Context
from celery.exceptions import Retry
from dify_trace_aliyun.aliyun_trace import AliyunDataTrace
from dify_trace_aliyun.config import AliyunConfig
from flask import Flask
from opentelemetry.sdk.metrics.export import ConsoleMetricExporter
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.ops.ops_trace_manager import OpsTraceManager
from enterprise.telemetry import exporter as ee_exporter_module
from enterprise.telemetry.exporter import EnterpriseExporter
from extensions import ext_enterprise_telemetry
from extensions.application_services.tracing import TracingServices, build_tracing_services
from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.tracing import bind_legacy_trace_capture
from machinery.legacy_tracing import LegacyTraceOwnershipUnavailableError
from models.model import App, AppMode, Message
from services.tracing import otlp_export
from services.tracing.adapters import send_to_enterprise_telemetry
from services.tracing.legacy_capture import LegacyTraceCaptureService
from services.tracing.provider_common import check_http_status
from services.tracing.provider_dispatch import TraceExportUncertainError
from services.tracing.records import MessageTraceInfo
from tasks import ops_trace_task
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.repositories.test_trace_record_repository import (
    APP_ID,
    MESSAGE_ID,
    TENANT_ID,
    _assembler,
)

pytest_plugins = ("tests.unit_tests.repositories.test_trace_record_repository",)

KEY = f"ops_trace/{APP_ID}/legacy-owned-file.json"
LEGACY_MESSAGE_ID = "7b3c6c0e-38a1-4b52-9a7e-3ad8f3a1c001"


@dataclass
class LegacyTaskDomain:
    app: Flask
    storage: Storage
    sessions: sessionmaker[Session]
    tracing: TracingServices
    requests: list[httpx.Request]
    outcome: dict[str, str]


@pytest.fixture
def legacy_domain(
    request: pytest.FixtureRequest,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[LegacyTaskDomain]:
    request.getfixturevalue("records")
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    tracing = build_tracing_services(database_client=sqlite_session_factory)
    app = Flask("owned-legacy-task")
    bind_legacy_trace_capture(app, tracing.legacy_capture)
    storage = Storage()
    storage.storage_runner = OpenDALStorage("fs", root=str(tmp_path / "payloads"))
    monkeypatch.setattr(ops_trace_task, "storage", storage)
    monkeypatch.setattr(ext_enterprise_telemetry, "is_enabled", lambda: False)

    native = AliyunDataTrace(
        AliyunConfig(app_name="owned-unit", license_key="synthetic-license", endpoint="https://collector.invalid")
    )
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", staticmethod(lambda _app_id: native))
    requests: list[httpx.Request] = []
    outcome = {"value": "ok"}

    def receive(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if outcome["value"] == "unknown":
            raise httpx.ReadTimeout("owned transport outcome unknown")
        return httpx.Response(503 if outcome["value"] == "retry" else 200, content=b'"success"')

    client = httpx.Client(transport=httpx.MockTransport(receive))

    def owned_request(
        method: str, url: str, provider: str, *, headers: Mapping[str, str], content: bytes
    ) -> httpx.Response:
        try:
            response = client.request(method, url, headers=headers, content=content)
        except httpx.TransportError:
            raise TraceExportUncertainError("owned transport acceptance unknown") from None
        check_http_status(response.status_code, provider)
        return response

    monkeypatch.setattr(otlp_export, "request", owned_request)
    message = sqlite_session.get(Message, MESSAGE_ID)
    assert message is not None
    message.id = LEGACY_MESSAGE_ID
    sqlite_session.commit()
    tool_config: dict[str, object] = {}
    tool_parameters: dict[str, object] = {}
    now = datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC)
    raw = {
        "trace_info_type": "ToolTraceInfo",  # exact producer className wire tag
        "trace_info": {
            "message_id": LEGACY_MESSAGE_ID,
            "message_data": message.to_dict(session=sqlite_session),
            "metadata": {"app_id": APP_ID, "tenant_id": TENANT_ID},
            "tool_name": "owned_lookup",
            "tool_inputs": {"query": "synthetic"},
            "tool_outputs": "synthetic-result",
            "tool_config": tool_config,
            "tool_parameters": tool_parameters,
            "time_cost": 0.25,
            "error": None,
            "file_url": None,
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(seconds=1)).isoformat(),
        },
    }
    storage.save(KEY, json.dumps(raw, default=str).encode())
    yield LegacyTaskDomain(app, storage, sqlite_session_factory, tracing, requests, outcome)
    client.close()


def _run(domain: LegacyTaskDomain, *, retries: int = 0) -> None:
    task = ops_trace_task.process_trace_tasks
    task.request_stack.push(Context(retries=retries, called_directly=False, is_eager=True))
    try:
        with domain.app.app_context():
            task.run({"app_id": APP_ID, "file_id": "legacy-owned-file"})
    finally:
        task.request_stack.pop()


def test_unmanaged_old_payload_reaches_actual_native_encoder_once(legacy_domain: LegacyTaskDomain) -> None:
    _run(legacy_domain)
    assert len(legacy_domain.requests) == 1
    assert legacy_domain.requests[0].content
    assert not legacy_domain.storage.storage_runner.exists(KEY)


def test_managed_source_never_reaches_legacy_native_export(legacy_domain: LegacyTaskDomain) -> None:
    with legacy_domain.sessions() as session:
        app = session.get(App, APP_ID)
        assert app is not None
        app.mode = AppMode.AGENT
        session.commit()
    _run(legacy_domain)
    assert legacy_domain.requests == []
    assert not legacy_domain.storage.storage_runner.exists(KEY)


def test_real_sql_unavailable_preserves_old_payload_and_never_falls_back(legacy_domain: LegacyTaskDomain) -> None:
    engine = create_engine("sqlite:///:memory:")  # real DB deliberately has no App table
    unavailable = _assembler(sessionmaker(bind=engine))
    capture = LegacyTraceCaptureService(
        owners=unavailable,
        records=unavailable,
        enterprise_records=unavailable,
        enterprise_sink=send_to_enterprise_telemetry,
        collector=legacy_domain.tracing.agent_traces,
        now=lambda: datetime(2026, 1, 1, tzinfo=UTC),
    )
    bind_legacy_trace_capture(legacy_domain.app, capture)
    try:
        with pytest.raises(Retry):
            _run(legacy_domain)
        assert legacy_domain.requests == []
        assert legacy_domain.storage.storage_runner.exists(KEY)
    finally:
        engine.dispose()


def test_unknown_native_acceptance_is_terminal_without_resend(legacy_domain: LegacyTaskDomain) -> None:
    legacy_domain.outcome["value"] = "unknown"
    _run(legacy_domain)
    assert len(legacy_domain.requests) == 1
    assert not legacy_domain.storage.storage_runner.exists(KEY)


def test_ambiguous_tenant_never_falls_back_and_retains_formally_delivered_payload(
    legacy_domain: LegacyTaskDomain,
) -> None:
    raw = json.loads(legacy_domain.storage.load(KEY))
    raw["trace_info"]["metadata"]["tenant_id"] = "another-workspace"
    legacy_domain.storage.save(KEY, json.dumps(raw).encode())
    with pytest.raises(Retry):
        _run(legacy_domain)
    assert legacy_domain.requests == []
    assert legacy_domain.storage.storage_runner.exists(KEY)


def test_legacy_message_terminal_marker_survives_real_source_reload(legacy_domain: LegacyTaskDomain) -> None:
    raw = json.loads(legacy_domain.storage.load(KEY))["trace_info"]
    raw["metadata"]["message_execution_state"] = "cancelled"
    current = legacy_domain.tracing.legacy_capture.enterprise_record(
        app_id=APP_ID, event_id="owned-message-state", trace_info_type="MessageTraceInfo", info=raw
    )
    assert isinstance(current, MessageTraceInfo)
    assert current.message_id == LEGACY_MESSAGE_ID
    assert current.metadata["message_execution_state"] == "cancelled"
    raw["metadata"]["message_execution_state"] = "unknown-state"
    with pytest.raises(LegacyTraceOwnershipUnavailableError, match="terminal state is invalid"):
        legacy_domain.tracing.legacy_capture.enterprise_record(
            app_id=APP_ID, event_id="owned-message-invalid", trace_info_type="MessageTraceInfo", info=raw
        )


def test_actual_enterprise_counter_is_emitted_once_across_native_retry(
    legacy_domain: LegacyTaskDomain, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = io.StringIO()
    span_exporter = InMemorySpanExporter()
    monkeypatch.setattr(ee_exporter_module._ExporterFactory, "create_trace_exporter", lambda _self: span_exporter)
    monkeypatch.setattr(
        ee_exporter_module._ExporterFactory, "create_metric_exporter", lambda _self: ConsoleMetricExporter(out=output)
    )
    exporter = EnterpriseExporter(dify_config)
    monkeypatch.setattr(ext_enterprise_telemetry, "get_enterprise_exporter", lambda: exporter)
    monkeypatch.setattr(ext_enterprise_telemetry, "is_enabled", lambda: True)
    legacy_domain.outcome["value"] = "retry"
    try:
        with pytest.raises(Retry):
            _run(legacy_domain)
        saved = json.loads(legacy_domain.storage.load(KEY))
        assert saved["_enterprise_trace_dispatched"] is True
        assert isinstance(saved["trace_info"]["message_data"], dict)
        legacy_domain.outcome["value"] = "ok"
        _run(legacy_domain, retries=1)
        exporter._meter_provider.force_flush()
        metrics = json.loads(output.getvalue())["resource_metrics"][0]["scope_metrics"][0]["metrics"]
        requests = next(metric for metric in metrics if metric["name"] == "dify.requests.total")
        assert requests["data"]["data_points"][0]["value"] == 1
        assert len(legacy_domain.requests) == 2
        assert not legacy_domain.storage.storage_runner.exists(KEY)
    finally:
        exporter._tracer_provider.shutdown()
        exporter._meter_provider.shutdown()


def test_invalid_legacy_reference_never_reads_or_deletes_owned_storage(legacy_domain: LegacyTaskDomain) -> None:
    with legacy_domain.app.app_context(), pytest.raises(ValueError, match="Invalid legacy trace payload reference"):
        ops_trace_task.process_trace_tasks.run({"app_id": "..", "file_id": "../outside"})
    assert legacy_domain.storage.storage_runner.exists(KEY)
