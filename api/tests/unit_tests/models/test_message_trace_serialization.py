"""Keep the persisted provider through private trace JSON and the real consumer."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from dify_trace_arize_phoenix import arize_phoenix_trace
from dify_trace_arize_phoenix.arize_phoenix_trace import ArizePhoenixDataTrace
from dify_trace_arize_phoenix.config import ArizeConfig
from openinference.semconv.trace import SpanAttributes
from opentelemetry.sdk.trace import Tracer, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import TypeAdapter
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import MessageTraceInfo
from core.ops.ops_trace_manager import OpsTraceManager, TaskData
from models.enums import ConversationFromSource
from models.model import Message, MessageDict
from tasks import ops_trace_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_message

_MESSAGE = TypeAdapter(MessageDict)


@pytest.fixture
def persisted_message(sqlite_session: Session) -> Message:
    now = datetime(2026, 10, 20, tzinfo=UTC)
    message = make_message(
        message_id=str(uuid4()),
        app_id=str(uuid4()),
        conversation_id=str(uuid4()),
        inputs={},
        query="Synthetic input",
        message={},
        answer="Synthetic output",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        created_at=now,
        updated_at=now + timedelta(seconds=1),
    )
    message.model_provider = "langgenius/openai/openai"
    message.model_id = "gpt-4o-mini"
    sqlite_session.add(message)
    sqlite_session.commit()
    sqlite_session.expire_all()
    restored = sqlite_session.get(Message, message.id)
    assert restored is not None
    return restored


@pytest.mark.parametrize("provider", ["langgenius/openai/openai", "Custom/Provider:Exact", None])
def test_message_provider_survives_real_json_round_trip(
    sqlite_session: Session,
    persisted_message: Message,
    provider: str | None,
) -> None:
    persisted_message.model_provider = provider
    sqlite_session.commit()
    sqlite_session.refresh(persisted_message)
    wire = json.dumps(persisted_message.to_dict(session=sqlite_session), default=str)
    payload = _MESSAGE.validate_json(wire)
    restored = Message.from_dict(payload)
    assert "model_provider" in payload
    assert restored.model_provider == provider
    assert restored.model_id == persisted_message.model_id
    assert restored.id == persisted_message.id


@pytest.mark.parametrize("shape", ["current", "legacy_missing", "explicit_null"])
def test_private_trace_task_preserves_provider_into_real_arize_span(
    sqlite_session: Session,
    persisted_message: Message,
    monkeypatch: pytest.MonkeyPatch,
    shape: str,
) -> None:
    message_data = persisted_message.to_dict(session=sqlite_session)
    if shape == "legacy_missing":
        message_data.pop("model_provider", None)
    elif shape == "explicit_null":
        message_data["model_provider"] = None
    start = datetime(2026, 10, 20, tzinfo=UTC)
    info = MessageTraceInfo(
        message_id=persisted_message.id,
        message_data=message_data,
        conversation_model="chat",
        conversation_mode="chat",
        inputs={"query": "Synthetic input"},
        outputs="Synthetic output",
        start_time=start,
        end_time=start + timedelta(seconds=1),
        metadata={},
        message_tokens=1,
        answer_tokens=1,
        total_tokens=2,
    )
    encoded = (
        TaskData(app_id=persisted_message.app_id, trace_info_type="MessageTraceInfo", trace_info=info.model_dump())
        .model_dump_json()
        .encode()
    )
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    processor = SimpleSpanProcessor(exporter)
    provider.add_span_processor(processor)

    def setup(_config: ArizeConfig) -> tuple[Tracer, SimpleSpanProcessor]:
        tracer = provider.get_tracer("message-provider-serialization")
        assert isinstance(tracer, Tracer)
        return tracer, processor

    monkeypatch.setattr(arize_phoenix_trace, "setup_tracer", setup)
    instance = ArizePhoenixDataTrace(ArizeConfig(api_key="unused-synthetic-key", space_id="synthetic-space"))
    paths: list[str] = []
    deleted: list[str] = []

    def load(path: str) -> bytes:
        paths.append(path)
        return encoded

    def delete(path: str) -> None:
        deleted.append(path)

    def lookup(app_id: str) -> ArizePhoenixDataTrace:
        assert app_id == persisted_message.app_id
        return instance

    def failed(_key: str) -> None:
        pytest.fail("The real trace consumer must not hide a failed dispatch")

    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
    monkeypatch.setattr(ops_trace_task.storage, "load", load)
    monkeypatch.setattr(ops_trace_task.storage, "delete", delete)
    monkeypatch.setattr(ops_trace_task.redis_client, "incr", failed)
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lookup)
    monkeypatch.setattr("extensions.ext_enterprise_telemetry.is_enabled", lambda: False)
    try:
        ops_trace_task.process_trace_tasks.apply(
            args=({"app_id": persisted_message.app_id, "file_id": "owned-synthetic"},), throw=True
        ).get()
        spans = exporter.get_finished_spans()
        llm = [span for span in spans if span.name == "llm"]
        assert len(llm) == 1
        attributes = llm[0].attributes
        assert attributes is not None
        assert attributes[SpanAttributes.LLM_MODEL_NAME] == persisted_message.model_id
        if shape == "current":
            assert attributes[SpanAttributes.LLM_PROVIDER] == persisted_message.model_provider
        else:
            assert SpanAttributes.LLM_PROVIDER not in attributes
        assert paths == [f"ops_trace/{persisted_message.app_id}/owned-synthetic.json"]
        assert deleted == paths
    finally:
        provider.shutdown()
