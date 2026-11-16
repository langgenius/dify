from collections.abc import Mapping

import pytest
from flask import Flask

from context.flask_app_context import capture_flask_context
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.layers import execution_context_layer
from core.app.layers.execution_context_layer import ExecutionContextLayer
from core.workflow.node_runtime import DifyPreparedLLM, DifyPromptMessageSerializer
from extensions.application_services.app_moderation import AppModeration
from graphon.engine import Engine
from graphon.engine_events import GraphRunPartialSucceededEvent, NodeRunRetryEvent
from graphon.enums import ErrorStrategy, WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.entities import CodeLanguage, CodeNodeData
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.nodes.parameter_extractor.parameter_extractor_node import (
    ParameterExtractorNode,
    _ParameterExtractorRunContext,
)
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import RuntimeState
from models.model import AppMode
from services.moderation_adapters import LLMModerationGuard
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_record import ModerationRecord, record_moderation_failure
from services.moderation_service import ModerationPhase, ModerationRejectedError
from tests.helpers.unit.core.model_moderation_fixtures import make_moderated_model
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


def test_record_preserves_first_rejected_phase_and_can_be_read_after_producer_exit() -> None:
    record = ModerationRecord("tenant")
    with record.activate():
        record_moderation_failure("tenant", phase="input", rejected=False)
        assert isinstance(record.read(), ModerationUnavailableInvocationError)
        record_moderation_failure("tenant", phase="output", rejected=True)
        record_moderation_failure("tenant", phase="input", rejected=True)
    for _ in range(2):
        error = record.read()
        assert isinstance(error, PlatformModerationRejectedInvocationError)
        assert error.phase == "output"
        assert str(error) == "Model output was rejected by moderation."
        assert error.__cause__ is None
        assert error.__traceback__ is None


def test_record_isolation_and_nested_context_cleanup() -> None:
    outer = ModerationRecord("tenant")
    inner = ModerationRecord("tenant")

    def fail_in_inner() -> None:
        with inner.activate():
            record_moderation_failure("tenant", phase="output", rejected=True)
            raise RuntimeError("producer failed")

    record_moderation_failure("tenant", phase="input", rejected=True)
    with outer.activate():
        record_moderation_failure("foreign", phase="input", rejected=True)
        assert outer.read() is None
        with pytest.raises(RuntimeError):
            fail_in_inner()
        assert outer.read() is None
        record_moderation_failure("tenant", phase="input", rejected=False)
    record_moderation_failure("tenant", phase="input", rejected=True)
    assert isinstance(outer.read(), ModerationUnavailableInvocationError)
    assert isinstance(inner.read(), PlatformModerationRejectedInvocationError)
    assert ModerationRecord("tenant").read() is None


def test_record_is_execution_owned_and_excluded_from_snapshots() -> None:
    app = Flask(__name__)
    app.extensions["app_moderation"] = AppModeration()
    with app.app_context():
        entity = WorkflowAppGenerateEntity(
            task_id="task",
            app_config=WorkflowUIBasedAppConfig(
                tenant_id="tenant-1", app_id="app-1", app_mode=AppMode.WORKFLOW, workflow_id="workflow"
            ),
            inputs={},
            files=[],
            user_id="user",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
            user_from=UserFrom.END_USER,
            workflow_execution_id="run",
        )
        assert entity.moderation_record is not None
        with entity.moderation_record.activate():
            record_moderation_failure("tenant-1", phase="input", rejected=True)
        snapshot = entity.model_dump()
        assert "moderation_record" not in snapshot
        resumed = WorkflowAppGenerateEntity.model_validate(snapshot)
        assert resumed.moderation_record is not None
        assert resumed.moderation_record is not entity.moderation_record
        assert resumed.moderation_record.read() is None
        assert isinstance(entity.moderation_record.read(), PlatformModerationRejectedInvocationError)


def _rejecting_guard() -> tuple[LLMModerationGuard, list[str]]:
    calls: list[str] = []

    def check(text: str, phase: ModerationPhase) -> None:
        calls.append(text)
        raise ModerationRejectedError(phase, "private backend message")

    return LLMModerationGuard(
        tenant_id="test-tenant-id",
        check=check,
        check_input=True,
        check_output=True,
        non_stream_segment_size=2000,
        stream_segment_size=2000,
        platform=True,
    ), calls


@pytest.mark.parametrize("strategy", ["retry", ErrorStrategy.DEFAULT_VALUE, ErrorStrategy.FAIL_BRANCH])
def test_record_does_not_change_graphon_retry_default_value_or_error_branch(
    monkeypatch: pytest.MonkeyPatch, strategy: str
) -> None:
    guard, calls = _rejecting_guard()
    record = ModerationRecord("test-tenant-id")

    class Executor:
        def execute(self, *, language: CodeLanguage, code: str, inputs: Mapping[str, object]) -> Mapping[str, object]:
            assert language == CodeLanguage.PYTHON3
            assert code == "unused"
            assert inputs == {}
            if not calls or strategy != "retry":
                guard.check_inputs([UserPromptMessage(content="blocked")])
            return {"output": "retried"}

        def is_execution_error(self, error: Exception) -> bool:
            return isinstance(error, PlatformModerationRejectedInvocationError)

    state = RuntimeState(workflow_id="workflow", variable_pool=build_test_variable_pool(), start_at=0.0)
    init_params = build_test_graph_init_params()
    start = StartNode(
        node_id="start", data=StartNodeData(title="Start", variables=[]), init_params=init_params, runtime_state=state
    )
    code = CodeNode(
        node_id="code",
        init_params=init_params,
        runtime_state=state,
        code_executor=Executor(),
        code_limits=CodeNodeLimits(1000, 1000, -1000, 10, 10, 100, 100, 100),
        data=CodeNodeData.model_validate(
            {
                "title": "Code",
                "code_language": "python3",
                "code": "unused",
                "variables": [],
                "outputs": {"output": {"type": "string"}},
                "error_strategy": None if strategy == "retry" else strategy,
                "default_value": [{"key": "output", "type": "string", "value": "default"}],
                "retry_config": {"retry_enabled": strategy == "retry", "max_retries": 1, "retry_interval": 0},
            }
        ),
    )
    end = EndNode(
        node_id="end",
        init_params=init_params,
        runtime_state=state,
        data=EndNodeData.model_validate(
            {
                "title": "End",
                "outputs": [
                    {
                        "variable": "answer",
                        "value_selector": [
                            "code",
                            "error_message" if strategy == ErrorStrategy.FAIL_BRANCH else "output",
                        ],
                    }
                ],
            }
        ),
    )
    graph = (
        Graph.new()
        .add_root(start)
        .add_node(code)
        .add_node(end, source_handle="fail-branch" if strategy == ErrorStrategy.FAIL_BRANCH else "source")
        .build()
    )
    monkeypatch.setattr(execution_context_layer, "capture_current_context", capture_flask_context)
    with Flask(__name__).app_context(), record.activate():
        host = ExecutionContextLayer()
    engine = Engine(graph=graph, runtime_state=state, workers=2)
    engine.add_layer(host)
    events = list(engine.run())
    terminal = events[-1]
    if strategy == "retry":
        assert isinstance(terminal, GraphRunPartialSucceededEvent)
        assert terminal.exceptions_count == 1
        assert terminal.outputs == {"answer": "retried"}
        assert any(isinstance(event, NodeRunRetryEvent) for event in events)
    else:
        assert isinstance(terminal, GraphRunPartialSucceededEvent)
        assert terminal.exceptions_count == 1
        assert terminal.outputs == {
            "answer": "default" if strategy == ErrorStrategy.DEFAULT_VALUE else "private backend message"
        }
    assert calls == ["blocked"]
    error = record.read()
    assert isinstance(error, PlatformModerationRejectedInvocationError)
    assert str(error) == "Model input was rejected by moderation."
    with record.activate(), pytest.raises(PlatformModerationRejectedInvocationError):
        guard.check_inputs([UserPromptMessage(content="blocked")])
    assert calls == ["blocked", "blocked"]


def test_native_parameter_extractor_can_drop_error_type_without_losing_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard, calls = _rejecting_guard()
    model, provider = make_moderated_model(quota=True, parts=["unused"], moderation=guard)
    prepared = DifyPreparedLLM(model)
    node = ParameterExtractorNode(
        node_id="extractor",
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=build_test_variable_pool(), start_at=0.0),
        model_instance=prepared,
        prompt_message_serializer=DifyPromptMessageSerializer(),
        data=ParameterExtractorNodeData.model_validate(
            {
                "type": "parameter-extractor",
                "title": "Extractor",
                "query": ["sys", "query"],
                "model": {"provider": "test-provider", "name": "test-model", "mode": "chat", "completion_params": {}},
                "parameters": [],
                "reasoning_mode": "prompt",
            }
        ),
    )
    context = _ParameterExtractorRunContext(
        model_instance=prepared,
        prompt_messages=[UserPromptMessage(content="blocked")],
        prompt_message_tools=[],
        process_data={},
        inputs={"query": "blocked"},
    )
    monkeypatch.setattr(node, "_prepare_run_context", lambda: context)
    record = ModerationRecord("test-tenant-id")
    with record.activate():
        result = node._run()
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == ""
    assert isinstance(record.read(), PlatformModerationRejectedInvocationError)
    assert provider.invocations == 0
    assert calls == ["blocked"]
