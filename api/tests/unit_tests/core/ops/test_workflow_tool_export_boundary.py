"""External traces retain the caller's Tool contract without source workflow internals."""

import json
from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import WorkflowTraceInfo
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder, RepositoryWorkflowExecutionLoader
from extensions.ext_database import db
from models import Account
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


@pytest.mark.parametrize("exporter", ["canonical", "mlflow"])
def test_external_workflow_trace_omits_source_internals(
    exporter: str, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    started_at = datetime(2025, 1, 1)
    public_inputs = {"query": "public tool input"}
    public_outputs = {"answer": "public tool output"}
    for index, (execution_id, app_id, origin) in enumerate(
        [
            ("outer-tool", "caller-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
            ("source-llm", "source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
            ("recursive-llm", "caller-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
        ]
    ):
        is_outer = execution_id == "outer-tool"
        sqlite_session.add(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id="tenant-1",
                app_id=app_id,
                workflow_id=f"{app_id}-workflow",
                workflow_run_id="run-1",
                triggered_from_workflow_id=None if is_outer else "caller-app-workflow",
                triggered_from_node_execution_id=None if is_outer else "outer-tool",
                triggered_from=origin,
                index=index,
                node_execution_id=execution_id,
                node_id=execution_id,
                node_type="tool" if is_outer else "llm",
                title=execution_id,
                inputs=json.dumps(public_inputs if is_outer else {"secret": "private source input"}),
                outputs=json.dumps(public_outputs if is_outer else {"text": "private source output"}),
                process_data=json.dumps(
                    {}
                    if is_outer
                    else {
                        "prompts": [{"role": "system", "text": "private source prompt"}],
                        "workflow_tool_root_app_id": "caller-app",
                    }
                ),
                status="succeeded",
                elapsed_time=1,
                created_at=started_at,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
            )
        )
    sqlite_session.commit()
    info = WorkflowTraceInfo(
        tenant_id="tenant-1",
        workflow_id="caller-workflow",
        workflow_run_id="run-1",
        workflow_run_elapsed_time=1,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="",
        metadata={"app_id": "caller-app"},
        start_time=started_at,
        end_time=started_at,
    )
    monkeypatch.setattr(type(db), "engine", property(lambda _: sqlite_session.get_bind()))
    monkeypatch.setattr(db, "session", sqlite_session)
    if exporter == "canonical":
        account = Account(name="Caller maintainer", email="caller@example.com")
        account.id = "account-1"
        trace = CanonicalTraceBuilder(RepositoryWorkflowExecutionLoader(lambda _: account)).build(info)
        assert trace is not None
        assert len(trace.spans) == 2
        payload = trace.model_dump_json()
        tool = next(span for span in trace.spans if span.id == "outer-tool")
        assert tool.inputs == public_inputs
        assert tool.outputs == public_outputs
    else:
        from dify_trace_mlflow.config import MLflowConfig
        from dify_trace_mlflow.mlflow_trace import MLflowDataTrace
        from mlflow.entities import Span
        from mlflow.tracing import provider
        from mlflow.tracing.processor.mlflow_v3 import MlflowV3SpanProcessor
        from mlflow.tracing.trace_manager import InMemoryTraceManager
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        monkeypatch.setattr("dify_trace_mlflow.mlflow_trace.mlflow.set_tracking_uri", lambda _uri: None)
        monkeypatch.setattr("dify_trace_mlflow.mlflow_trace.mlflow.set_experiment", lambda **_kwargs: None)
        monkeypatch.setattr("mlflow.tracking.fluent._active_experiment_id", "0")
        monkeypatch.setattr(InMemoryTraceManager, "_instance", InMemoryTraceManager())
        monkeypatch.setenv("MLFLOW_ENABLE_ASYNC_TRACE_LOGGING", "true")
        span_exporter = InMemorySpanExporter()
        tracer_provider = TracerProvider()
        tracer_provider.add_span_processor(MlflowV3SpanProcessor(span_exporter, export_metrics=False))
        monkeypatch.setattr(provider, "_get_tracer", tracer_provider.get_tracer)
        try:
            MLflowDataTrace(MLflowConfig()).workflow_trace(info)
            spans = [Span(span) for span in span_exporter.get_finished_spans()]
            assert len(spans) == 2
            payload = json.dumps([span.to_dict() for span in spans])
            tool = next(span for span in spans if span.name == "outer-tool")
            assert tool.inputs == public_inputs
            assert tool.outputs == public_outputs
        finally:
            tracer_provider.shutdown()
    assert "private source" not in payload
    assert "source-llm" not in payload
    assert "recursive-llm" not in payload
    assert "workflow_tool_root_app_id" not in payload
