"""External traces retain the caller's Tool contract without source workflow internals."""

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from core.ops.entities.trace_entity import WorkflowTraceInfo
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder, RepositoryWorkflowExecutionLoader
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
    database = SimpleNamespace(engine=sqlite_session.get_bind(), session=sqlite_session)
    if exporter == "canonical":
        monkeypatch.setattr("core.ops.unified_trace.trace_builder.db", database)
        account = Account(name="Caller maintainer", email="caller@example.com")
        account.id = "account-1"
        trace = CanonicalTraceBuilder(RepositoryWorkflowExecutionLoader(lambda _: account)).build(info)
        assert trace is not None
        payload = trace.model_dump_json()
        tool = next(span for span in trace.spans if span.id == "outer-tool")
        assert tool.inputs == public_inputs
        assert tool.outputs == public_outputs
    else:
        from dify_trace_mlflow.mlflow_trace import MLflowDataTrace

        monkeypatch.setattr("dify_trace_mlflow.mlflow_trace.db", database)
        spans: dict[str, MagicMock] = {}

        def create_span(**kwargs: object) -> MagicMock:
            span = MagicMock()
            spans[str(kwargs["name"])] = span
            return span

        start_span = MagicMock(side_effect=create_span)
        monkeypatch.setattr("dify_trace_mlflow.mlflow_trace._start_span_no_context", start_span)
        exporter_instance = object.__new__(MLflowDataTrace)
        monkeypatch.setattr(exporter_instance, "_set_trace_metadata", MagicMock())
        exporter_instance.workflow_trace(info)
        payload = str(start_span.call_args_list)
        tool_call = next(call for call in start_span.call_args_list if call.kwargs["name"] == "outer-tool")
        assert tool_call.kwargs["inputs"] == public_inputs
        assert spans["outer-tool"].end.call_args.kwargs["outputs"] == public_outputs
        assert start_span.call_count == 2
    assert "private source" not in payload
    assert "source-llm" not in payload
    assert "recursive-llm" not in payload
