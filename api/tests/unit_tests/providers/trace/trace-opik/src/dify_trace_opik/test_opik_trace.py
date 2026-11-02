"""Legacy external IDs retain stable SDK batches and workflow parent relations."""

import json
from datetime import datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from dify_trace_opik.opik_trace import OpikDataTrace, prepare_opik_uuid
from opik import Opik
from opik.config import OpikConfig as SDKConfig
from opik.id_helpers import uuid4_to_uuid7
from opik.message_processing.batching.batchers import CreateSpanMessageBatcher, CreateTraceMessageBatcher
from opik.message_processing.messages import (
    BaseMessage,
    CreateSpanMessage,
    CreateSpansBatchMessage,
    CreateTraceBatchMessage,
    CreateTraceMessage,
)
from opik.message_processing.streamer import Streamer
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.ops.entities.trace_entity import WorkflowTraceInfo
from extensions.ext_database import db
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    _dict_to_workflow_node_execution_model,
)
from models.account import TenantAccountJoin, TenantAccountRole
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant

START = datetime(2026, 10, 16, 15, 18, 10, 792586)
WORKFLOW_ID = "11111111-2222-4333-8444-555555555555"
EXTERNAL_IDS = [
    "0123456789abcdef0123456789abcdef",
    "019140fb-6972-7d74-a219-6cba9eb543b1",
    str(uuid5(NAMESPACE_URL, "external-trace")),
    "external-trace_correlation",
]


@pytest.mark.parametrize("identifier", [WORKFLOW_ID, WORKFLOW_ID.upper(), UUID(WORKFLOW_ID).hex])
def test_valid_uuid4_keeps_the_original_sdk_mapping(identifier: str) -> None:
    assert prepare_opik_uuid(START, identifier) == uuid4_to_uuid7(START, identifier)


@pytest.mark.parametrize("identifier", EXTERNAL_IDS)
def test_external_identifiers_become_stable_uuid7_with_unchanged_time(identifier: str) -> None:
    mapped = prepare_opik_uuid(START, identifier)
    assert mapped.version == 7
    assert mapped == prepare_opik_uuid(START, identifier)
    assert int.from_bytes(mapped.bytes[:6]) == int(START.timestamp() * 1000)
    assert mapped != prepare_opik_uuid(START, identifier + "-different")


def test_missing_identifier_keeps_random_fallback() -> None:
    first, second = prepare_opik_uuid(START, None), prepare_opik_uuid(START, None)
    assert first.version == second.version == 7
    assert first != second
    assert int.from_bytes(first.bytes[:6]) == int(START.timestamp() * 1000)
    assert prepare_opik_uuid(None, WORKFLOW_ID).version == 7


@pytest.mark.parametrize("external_id", [*EXTERNAL_IDS, WORKFLOW_ID, None])
def test_workflow_external_ids_reach_real_sdk_batches_with_complete_owned_tree(
    external_id: str | None,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id, app_id, account_id, definition_id = (str(uuid4()) for _ in range(4))
    node_ids = [str(uuid4()) for _ in range(3)]
    with sqlite_session_factory.begin() as session:
        session.add(make_tenant(tenant_id=tenant_id))
        session.add(make_account(account_id=account_id))
        session.add(
            TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=TenantAccountRole.OWNER, current=True)
        )
        session.add(make_app(app_id=app_id, tenant_id=tenant_id, created_by=account_id))
        for index, kind in enumerate(("start", "llm", "end")):
            usage = {"prompt_tokens": 27, "completion_tokens": 5, "total_tokens": 32}
            process: dict[str, object] = (
                {
                    "model_mode": "chat",
                    "model_name": "test-model",
                    "model_provider": "provider/test",
                    "usage": usage,
                    "prompts": [{"role": "user", "content": "synthetic"}],
                }
                if kind == "llm"
                else {}
            )
            session.add(
                _dict_to_workflow_node_execution_model(
                    {
                        "id": node_ids[index],
                        "tenant_id": tenant_id,
                        "app_id": app_id,
                        "workflow_id": definition_id,
                        "workflow_run_id": WORKFLOW_ID,
                        "node_id": kind,
                        "node_type": kind,
                        "title": kind,
                        "created_by": account_id,
                        "created_at": (START + timedelta(milliseconds=index * 100)).isoformat(),
                        "status": "succeeded",
                        "index": index,
                        "elapsed_time": 0.1,
                        "inputs": json.dumps({}),
                        "outputs": json.dumps({"answer": "synthetic"}),
                        "process_data": json.dumps(process),
                        "execution_metadata": json.dumps({"total_tokens": 32} if kind == "llm" else {}),
                    }
                )
            )
        # A node from another run must not enter this trace's SDK batch.
        session.add(
            _dict_to_workflow_node_execution_model(
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "app_id": app_id,
                    "workflow_id": definition_id,
                    "workflow_run_id": str(uuid4()),
                    "node_id": "foreign",
                    "node_type": "llm",
                    "title": "foreign",
                    "created_by": account_id,
                    "created_at": START.isoformat(),
                    "status": "succeeded",
                    "elapsed_time": 0.1,
                }
            )
        )

    # Bind the real SQLAlchemy owner to the test engine; no Session/repository double.
    monkeypatch.setattr(type(db), "engine", property(lambda _owner: sqlite_engine))
    queued: list[BaseMessage] = []
    streamer = object.__new__(Streamer)
    monkeypatch.setattr(streamer, "put", queued.append)
    client = object.__new__(Opik)
    client._streamer = streamer
    client._config = SDKConfig.model_construct(url_override="https://offline.invalid/api", project_name="test-project")
    client._project_name = "test-project"
    client._project_name_most_recent_trace = None
    instance = object.__new__(OpikDataTrace)
    instance.opik_client = client
    instance.project = "test-project"
    info = WorkflowTraceInfo(
        workflow_id=definition_id,
        tenant_id=tenant_id,
        workflow_run_id=WORKFLOW_ID,
        workflow_run_elapsed_time=1,
        workflow_run_status="succeeded",
        workflow_run_inputs={"query": "synthetic"},
        workflow_run_outputs={"answer": "synthetic"},
        workflow_run_version="draft",
        total_tokens=32,
        file_list=[],
        query="synthetic",
        metadata={"app_id": app_id},
        start_time=START,
        end_time=START + timedelta(seconds=1),
        trace_id=external_id,
    )
    instance.workflow_trace(info)
    trace_batches: list[BaseMessage] = []
    span_batches: list[BaseMessage] = []
    trace_batcher = CreateTraceMessageBatcher(trace_batches.append, 1000, 2)
    span_batcher = CreateSpanMessageBatcher(span_batches.append, 1000, 2)
    for message in queued:
        if isinstance(message, CreateTraceMessage):
            trace_batcher.add(message)
        elif isinstance(message, CreateSpanMessage):
            span_batcher.add(message)
        else:
            pytest.fail("Unexpected SDK message type")
    trace_batcher.flush()
    span_batcher.flush()
    assert len(trace_batches) == len(span_batches) == 1
    trace_batch, span_batch = trace_batches[0], span_batches[0]
    assert isinstance(trace_batch, CreateTraceBatchMessage)
    assert isinstance(span_batch, CreateSpansBatchMessage)
    assert len(trace_batch.batch) == 1
    assert len(span_batch.batch) == 4
    trace = trace_batch.batch[0]
    root = next(span for span in span_batch.batch if span.parent_span_id is None)
    assert trace.id == str(prepare_opik_uuid(START, external_id or WORKFLOW_ID))
    assert trace.start_time.timestamp() == START.timestamp()
    assert root.id != trace.id
    assert {span.trace_id for span in span_batch.batch} == {trace.id}
    assert len({span.id for span in span_batch.batch}) == 4
    assert all(UUID(str(span.id)).version == 7 for span in span_batch.batch)
    children = [span for span in span_batch.batch if span.parent_span_id is not None]
    assert all(span.parent_span_id == root.id for span in children)
    assert {span.metadata["node_execution_id"] for span in children if isinstance(span.metadata, dict)} == set(node_ids)
    for index, node_id in enumerate(node_ids):
        child = next(
            span
            for span in children
            if isinstance(span.metadata, dict) and span.metadata["node_execution_id"] == node_id
        )
        assert child.start_time.timestamp() == (START + timedelta(milliseconds=index * 100)).timestamp()
        assert child.end_time is not None
        assert (child.end_time - child.start_time).total_seconds() == pytest.approx(0.1)
    llm = next(span for span in children if span.type == "llm")
    assert llm.usage is not None
    assert {key: llm.usage[key] for key in ("prompt_tokens", "completion_tokens", "total_tokens")} == {
        "prompt_tokens": 27,
        "completion_tokens": 5,
        "total_tokens": 32,
    }
    assert sum(span.usage.get("total_tokens", 0) for span in span_batch.batch if span.usage) == 32
    assert trace.output == {"answer": "synthetic"}
