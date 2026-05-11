import collections
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.entities.langsmith_trace_entity import (
    LangSmithRunModel,
    LangSmithRunType,
    LangSmithRunUpdateModel,
)
from dify_trace_langsmith.langsmith_trace import LangSmithDataTrace

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowTraceInfo,
)
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from models import EndUser


def _dt() -> datetime:
    return datetime(2024, 1, 1, 0, 0, 0)


@pytest.fixture
def langsmith_config():
    return LangSmithConfig(api_key="ls-123", project="default", endpoint="https://api.smith.langchain.com")


@pytest.fixture
def trace_instance(langsmith_config, monkeypatch: pytest.MonkeyPatch):
    # Mock LangSmith client
    mock_client = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.Client", lambda **kwargs: mock_client)

    instance = LangSmithDataTrace(langsmith_config)
    return instance


def test_init(langsmith_config, monkeypatch: pytest.MonkeyPatch):
    mock_client_class = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.Client", mock_client_class)
    monkeypatch.setenv("FILES_URL", "http://test.url")

    instance = LangSmithDataTrace(langsmith_config)

    mock_client_class.assert_called_once_with(api_key=langsmith_config.api_key, api_url=langsmith_config.endpoint)
    assert instance.langsmith_key == langsmith_config.api_key
    assert instance.project_name == langsmith_config.project
    assert instance.file_base_url == "http://test.url"


def test_trace_dispatch(trace_instance, monkeypatch: pytest.MonkeyPatch):
    methods = [
        "workflow_trace",
        "message_trace",
        "moderation_trace",
        "suggested_question_trace",
        "dataset_retrieval_trace",
        "tool_trace",
        "generate_name_trace",
    ]
    mocks = {method: MagicMock() for method in methods}
    for method, m in mocks.items():
        monkeypatch.setattr(trace_instance, method, m)

    # WorkflowTraceInfo
    info = MagicMock(spec=WorkflowTraceInfo)
    trace_instance.trace(info)
    mocks["workflow_trace"].assert_called_once_with(info)

    # MessageTraceInfo
    info = MagicMock(spec=MessageTraceInfo)
    trace_instance.trace(info)
    mocks["message_trace"].assert_called_once_with(info)

    # ModerationTraceInfo
    info = MagicMock(spec=ModerationTraceInfo)
    trace_instance.trace(info)
    mocks["moderation_trace"].assert_called_once_with(info)

    # SuggestedQuestionTraceInfo
    info = MagicMock(spec=SuggestedQuestionTraceInfo)
    trace_instance.trace(info)
    mocks["suggested_question_trace"].assert_called_once_with(info)

    # DatasetRetrievalTraceInfo
    info = MagicMock(spec=DatasetRetrievalTraceInfo)
    trace_instance.trace(info)
    mocks["dataset_retrieval_trace"].assert_called_once_with(info)

    # ToolTraceInfo
    info = MagicMock(spec=ToolTraceInfo)
    trace_instance.trace(info)
    mocks["tool_trace"].assert_called_once_with(info)

    # GenerateNameTraceInfo
    info = MagicMock(spec=GenerateNameTraceInfo)
    trace_instance.trace(info)
    mocks["generate_name_trace"].assert_called_once_with(info)


def test_workflow_trace(trace_instance, monkeypatch: pytest.MonkeyPatch):
    # Setup trace info
    workflow_data = MagicMock()
    workflow_data.created_at = _dt()
    workflow_data.finished_at = _dt() + timedelta(seconds=1)

    trace_info = WorkflowTraceInfo(
        tenant_id="tenant-1",
        workflow_id="wf-1",
        workflow_run_id="run-1",
        workflow_run_inputs={"input": "hi"},
        workflow_run_outputs={"output": "hello"},
        workflow_run_status="succeeded",
        workflow_run_version="1.0",
        workflow_run_elapsed_time=1.0,
        total_tokens=100,
        file_list=[],
        query="hi",
        message_id="msg-1",
        conversation_id="conv-1",
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id="trace-1",
        metadata={"app_id": "app-1"},
        workflow_app_log_id="log-1",
        error="",
        workflow_data=workflow_data,
    )

    # Mock dependencies
    mock_session = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.sessionmaker", lambda bind: lambda: mock_session)
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.db", MagicMock(engine="engine"))

    # Mock node executions
    node_llm = MagicMock()
    node_llm.id = "node-llm"
    node_llm.title = "LLM Node"
    node_llm.node_type = BuiltinNodeTypes.LLM
    node_llm.status = "succeeded"
    node_llm.process_data = {
        "model_mode": "chat",
        "model_name": "gpt-4",
        "model_provider": "openai",
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }
    node_llm.inputs = {"prompts": "p"}
    node_llm.outputs = {"text": "t"}
    node_llm.created_at = _dt()
    node_llm.elapsed_time = 0.5
    node_llm.metadata = {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 30}

    node_other = MagicMock()
    node_other.id = "node-other"
    node_other.title = "Tool Node"
    node_other.node_type = BuiltinNodeTypes.TOOL
    node_other.status = "succeeded"
    node_other.process_data = None
    node_other.inputs = {"tool_input": "val"}
    node_other.outputs = {"tool_output": "val"}
    node_other.created_at = None  # Trigger datetime.now()
    node_other.elapsed_time = 0.2
    node_other.metadata = {}

    node_retrieval = MagicMock()
    node_retrieval.id = "node-retrieval"
    node_retrieval.title = "Retrieval Node"
    node_retrieval.node_type = BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL
    node_retrieval.status = "succeeded"
    node_retrieval.process_data = None
    node_retrieval.inputs = {"query": "val"}
    node_retrieval.outputs = {"results": "val"}
    node_retrieval.created_at = _dt()
    node_retrieval.elapsed_time = 0.2
    node_retrieval.metadata = {}

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = [node_llm, node_other, node_retrieval]

    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.DifyCoreRepositoryFactory", mock_factory)

    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_run = MagicMock()

    trace_instance.workflow_trace(trace_info)

    # Verify add_run calls
    # 1. message run (id="msg-1")
    # 2. workflow run (id="run-1")
    # 3. node llm run (id="node-llm")
    # 4. node other run (id="node-other")
    # 5. node retrieval run (id="node-retrieval")
    assert trace_instance.add_run.call_count == 5

    call_args = [call[0][0] for call in trace_instance.add_run.call_args_list]

    assert call_args[0].id == "msg-1"
    assert call_args[0].name == TraceTaskName.MESSAGE_TRACE
    # trace_id must equal root run's id (message_id), not the external trace_id "trace-1"
    assert call_args[0].trace_id == "msg-1"

    assert call_args[1].id == "run-1"
    assert call_args[1].name == TraceTaskName.WORKFLOW_TRACE
    assert call_args[1].parent_run_id == "msg-1"
    assert call_args[1].trace_id == "msg-1"

    assert call_args[2].id == "node-llm"
    assert call_args[2].run_type == LangSmithRunType.llm
    assert call_args[2].trace_id == "msg-1"

    assert call_args[3].id == "node-other"
    assert call_args[3].run_type == LangSmithRunType.tool

    assert call_args[4].id == "node-retrieval"
    assert call_args[4].run_type == LangSmithRunType.retriever


def test_workflow_trace_no_start_time(trace_instance, monkeypatch: pytest.MonkeyPatch):
    workflow_data = MagicMock()
    workflow_data.created_at = _dt()
    workflow_data.finished_at = _dt() + timedelta(seconds=1)

    trace_info = WorkflowTraceInfo(
        tenant_id="tenant-1",
        workflow_id="wf-1",
        workflow_run_id="run-1",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_status="succeeded",
        workflow_run_version="1.0",
        workflow_run_elapsed_time=1.0,
        total_tokens=10,
        file_list=[],
        query="hi",
        message_id="msg-1",
        conversation_id="conv-1",
        start_time=None,
        end_time=None,
        trace_id="trace-1",
        metadata={"app_id": "app-1"},
        workflow_app_log_id="log-1",
        error="",
        workflow_data=workflow_data,
    )

    mock_session = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.sessionmaker", lambda bind: lambda: mock_session)
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.db", MagicMock(engine="engine"))
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.DifyCoreRepositoryFactory", mock_factory)
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_run = MagicMock()
    trace_instance.workflow_trace(trace_info)
    assert trace_instance.add_run.called


def test_workflow_trace_missing_app_id(trace_instance, monkeypatch: pytest.MonkeyPatch):
    trace_info = MagicMock(spec=WorkflowTraceInfo)
    trace_info.trace_id = "trace-1"
    trace_info.message_id = None
    trace_info.workflow_run_id = "run-1"
    trace_info.start_time = None
    trace_info.workflow_data = MagicMock()
    trace_info.workflow_data.created_at = _dt()
    trace_info.metadata = {}  # Empty metadata
    trace_info.workflow_app_log_id = "log-1"
    trace_info.file_list = []
    trace_info.total_tokens = 0
    trace_info.workflow_run_inputs = {}
    trace_info.workflow_run_outputs = {}
    trace_info.error = ""

    mock_session = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.sessionmaker", lambda bind: lambda: mock_session)
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.db", MagicMock(engine="engine"))

    with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
        trace_instance.workflow_trace(trace_info)


def test_message_trace(trace_instance, monkeypatch: pytest.MonkeyPatch):
    message_data = MagicMock()
    message_data.id = "msg-1"
    message_data.from_account_id = "acc-1"
    message_data.from_end_user_id = "end-user-1"
    message_data.answer = "hello answer"

    trace_info = MessageTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs={"input": "hi"},
        outputs={"answer": "hello"},
        message_tokens=10,
        answer_tokens=20,
        total_tokens=30,
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id="trace-1",
        metadata={"foo": "bar"},
        conversation_mode="chat",
        conversation_model="gpt-4",
        file_list=[],
        error=None,
        message_file_data=MagicMock(url="file-url"),
    )

    # Mock EndUser lookup
    mock_end_user = MagicMock(spec=EndUser)
    mock_end_user.session_id = "session-id-123"
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.db.session.get", lambda model, pk: mock_end_user)

    trace_instance.add_run = MagicMock()

    trace_instance.message_trace(trace_info)

    # 1. message run
    # 2. llm run
    assert trace_instance.add_run.call_count == 2

    call_args = [call[0][0] for call in trace_instance.add_run.call_args_list]
    assert call_args[0].id == "msg-1"
    assert call_args[0].extra["metadata"]["end_user_id"] == "session-id-123"
    assert call_args[1].parent_run_id == "msg-1"
    assert call_args[1].name == "llm"


def test_message_trace_no_data(trace_instance):
    trace_info = MagicMock(spec=MessageTraceInfo)
    trace_info.message_data = None
    trace_info.file_list = []
    trace_info.message_file_data = None
    trace_info.metadata = {}
    trace_instance.add_run = MagicMock()
    trace_instance.message_trace(trace_info)
    trace_instance.add_run.assert_not_called()


def test_moderation_trace_no_data(trace_instance):
    trace_info = MagicMock(spec=ModerationTraceInfo)
    trace_info.message_data = None
    trace_instance.add_run = MagicMock()
    trace_instance.moderation_trace(trace_info)
    trace_instance.add_run.assert_not_called()


def test_suggested_question_trace_no_data(trace_instance):
    trace_info = MagicMock(spec=SuggestedQuestionTraceInfo)
    trace_info.message_data = None
    trace_instance.add_run = MagicMock()
    trace_instance.suggested_question_trace(trace_info)
    trace_instance.add_run.assert_not_called()


def test_dataset_retrieval_trace_no_data(trace_instance):
    trace_info = MagicMock(spec=DatasetRetrievalTraceInfo)
    trace_info.message_data = None
    trace_instance.add_run = MagicMock()
    trace_instance.dataset_retrieval_trace(trace_info)
    trace_instance.add_run.assert_not_called()


def test_moderation_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = ModerationTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs={"q": "hi"},
        action="stop",
        flagged=True,
        preset_response="blocked",
        start_time=None,
        end_time=None,
        metadata={},
        trace_id="trace-1",
        query="hi",
    )

    trace_instance.add_run = MagicMock()
    trace_instance.moderation_trace(trace_info)
    trace_instance.add_run.assert_called_once()
    assert trace_instance.add_run.call_args[0][0].name == TraceTaskName.MODERATION_TRACE


def test_suggested_question_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = SuggestedQuestionTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs="hi",
        suggested_question=["q1"],
        total_tokens=10,
        level="info",
        start_time=None,
        end_time=None,
        metadata={},
        trace_id="trace-1",
    )

    trace_instance.add_run = MagicMock()
    trace_instance.suggested_question_trace(trace_info)
    trace_instance.add_run.assert_called_once()
    assert trace_instance.add_run.call_args[0][0].name == TraceTaskName.SUGGESTED_QUESTION_TRACE


def test_dataset_retrieval_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = DatasetRetrievalTraceInfo(
        message_id="msg-1",
        message_data=message_data,
        inputs="query",
        documents=[{"id": "doc1"}],
        start_time=None,
        end_time=None,
        metadata={},
        trace_id="trace-1",
    )

    trace_instance.add_run = MagicMock()
    trace_instance.dataset_retrieval_trace(trace_info)
    trace_instance.add_run.assert_called_once()
    assert trace_instance.add_run.call_args[0][0].name == TraceTaskName.DATASET_RETRIEVAL_TRACE


def test_tool_trace(trace_instance):
    trace_info = ToolTraceInfo(
        message_id="msg-1",
        message_data=MagicMock(),
        inputs={},
        outputs={},
        tool_name="my_tool",
        tool_inputs={"a": 1},
        tool_outputs="result",
        time_cost=0.1,
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        trace_id="trace-1",
        tool_config={},
        tool_parameters={},
        file_url="http://file",
    )

    trace_instance.add_run = MagicMock()
    trace_instance.tool_trace(trace_info)
    trace_instance.add_run.assert_called_once()
    assert trace_instance.add_run.call_args[0][0].name == "my_tool"


def test_generate_name_trace(trace_instance):
    trace_info = GenerateNameTraceInfo(
        inputs={"q": "hi"},
        outputs={"name": "new"},
        tenant_id="tenant-1",
        conversation_id="conv-1",
        start_time=None,
        end_time=None,
        metadata={},
        trace_id="trace-1",
    )

    trace_instance.add_run = MagicMock()
    trace_instance.generate_name_trace(trace_info)
    trace_instance.add_run.assert_called_once()
    assert trace_instance.add_run.call_args[0][0].name == TraceTaskName.GENERATE_NAME_TRACE


def test_add_run_success(trace_instance):
    run_data = LangSmithRunModel(
        id="run-1", name="test", inputs={}, outputs={}, run_type=LangSmithRunType.tool, start_time=_dt()
    )
    trace_instance.project_id = "proj-1"
    trace_instance.add_run(run_data)
    trace_instance.langsmith_client.create_run.assert_called_once()
    args, kwargs = trace_instance.langsmith_client.create_run.call_args
    assert kwargs["session_id"] == "proj-1"


def test_add_run_error(trace_instance):
    run_data = LangSmithRunModel(id="run-1", name="test", run_type=LangSmithRunType.tool, start_time=_dt())
    trace_instance.langsmith_client.create_run.side_effect = Exception("failed")
    with pytest.raises(ValueError, match="LangSmith Failed to create run: failed"):
        trace_instance.add_run(run_data)


def test_update_run_success(trace_instance):
    update_data = LangSmithRunUpdateModel(run_id="run-1", outputs={"out": "val"})
    trace_instance.update_run(update_data)
    trace_instance.langsmith_client.update_run.assert_called_once()


def test_update_run_error(trace_instance):
    update_data = LangSmithRunUpdateModel(run_id="run-1")
    trace_instance.langsmith_client.update_run.side_effect = Exception("failed")
    with pytest.raises(ValueError, match="LangSmith Failed to update run: failed"):
        trace_instance.update_run(update_data)


def test_workflow_trace_usage_extraction_error(trace_instance, monkeypatch: pytest.MonkeyPatch, caplog):
    workflow_data = MagicMock()
    workflow_data.created_at = _dt()
    workflow_data.finished_at = _dt() + timedelta(seconds=1)

    trace_info = WorkflowTraceInfo(
        tenant_id="tenant-1",
        workflow_id="wf-1",
        workflow_run_id="run-1",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_status="succeeded",
        workflow_run_version="1.0",
        workflow_run_elapsed_time=1.0,
        total_tokens=100,
        file_list=[],
        query="hi",
        message_id="msg-1",
        conversation_id="conv-1",
        start_time=_dt(),
        end_time=_dt(),
        trace_id="trace-1",
        metadata={"app_id": "app-1"},
        workflow_app_log_id="log-1",
        error="",
        workflow_data=workflow_data,
    )

    class BadDict(collections.UserDict):
        def get(self, key, default=None):
            if key == "usage":
                raise Exception("Usage extraction failed")
            return super().get(key, default)

    node_llm = MagicMock()
    node_llm.id = "node-llm"
    node_llm.title = "LLM Node"
    node_llm.node_type = BuiltinNodeTypes.LLM
    node_llm.status = "succeeded"
    node_llm.process_data = BadDict({"model_mode": "chat", "model_name": "gpt-4", "usage": True, "prompts": ["p"]})
    node_llm.inputs = {}
    node_llm.outputs = {}
    node_llm.created_at = _dt()
    node_llm.elapsed_time = 0.5
    node_llm.metadata = {}

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = [node_llm]

    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.DifyCoreRepositoryFactory", mock_factory)
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.sessionmaker", lambda bind: lambda: MagicMock())
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.db", MagicMock(engine="engine"))
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_run = MagicMock()

    import logging

    with caplog.at_level(logging.ERROR):
        trace_instance.workflow_trace(trace_info)

    assert "Failed to extract usage" in caplog.text


def test_api_check_success(trace_instance):
    assert trace_instance.api_check() is True
    assert trace_instance.langsmith_client.create_project.called
    assert trace_instance.langsmith_client.delete_project.called


def test_api_check_error(trace_instance):
    trace_instance.langsmith_client.create_project.side_effect = Exception("error")
    with pytest.raises(ValueError, match="LangSmith API check failed: error"):
        trace_instance.api_check()


def test_get_project_url_success(trace_instance):
    trace_instance.langsmith_client.get_run_url.return_value = "https://smith.langchain.com/o/org/p/proj/r/run"
    url = trace_instance.get_project_url()
    assert url == "https://smith.langchain.com/o/org/p/proj"


def test_get_project_url_error(trace_instance):
    trace_instance.langsmith_client.get_run_url.side_effect = Exception("error")
    with pytest.raises(ValueError, match="LangSmith get run url failed: error"):
        trace_instance.get_project_url()


def _make_workflow_trace_info(
    *, message_id: str | None, workflow_run_id: str, trace_id: str | None
) -> WorkflowTraceInfo:
    workflow_data = MagicMock()
    workflow_data.created_at = _dt()
    workflow_data.finished_at = _dt() + timedelta(seconds=1)
    return WorkflowTraceInfo(
        tenant_id="tenant-1",
        workflow_id="wf-1",
        workflow_run_id=workflow_run_id,
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_status="succeeded",
        workflow_run_version="1.0",
        workflow_run_elapsed_time=1.0,
        total_tokens=0,
        file_list=[],
        query="q",
        message_id=message_id,
        conversation_id="conv-1" if message_id else None,
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id=trace_id,
        metadata={"app_id": "app-1"},
        workflow_app_log_id=None,
        error=None,
        workflow_data=workflow_data,
    )


def _patch_workflow_trace_deps(monkeypatch, trace_instance):
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.sessionmaker", lambda bind: lambda: MagicMock())
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.db", MagicMock(engine="engine"))
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    factory = MagicMock()
    factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.DifyCoreRepositoryFactory", factory)
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())
    trace_instance.add_run = MagicMock()


def test_workflow_trace_id_uses_message_id_not_external(trace_instance, monkeypatch):
    """Chatflow with external trace_id: LangSmith trace_id must be message_id, not external."""
    trace_info = _make_workflow_trace_info(
        message_id="msg-abc",
        workflow_run_id="run-xyz",
        trace_id="external-999",
    )
    _patch_workflow_trace_deps(monkeypatch, trace_instance)

    trace_instance.workflow_trace(trace_info)

    calls = [c[0][0] for c in trace_instance.add_run.call_args_list]
    # message run (root) and workflow run (child) must both use message_id as trace_id
    assert calls[0].id == "msg-abc"
    assert calls[0].trace_id == "msg-abc"
    assert calls[1].id == "run-xyz"
    assert calls[1].trace_id == "msg-abc"
    # external_trace_id preserved in metadata
    assert trace_info.metadata.get("external_trace_id") == "external-999"


def test_workflow_trace_id_pure_workflow_uses_run_id(trace_instance, monkeypatch):
    """Pure workflow (no message_id) with external trace_id: trace_id must be workflow_run_id."""
    trace_info = _make_workflow_trace_info(
        message_id=None,
        workflow_run_id="run-xyz",
        trace_id="external-999",
    )
    _patch_workflow_trace_deps(monkeypatch, trace_instance)

    trace_instance.workflow_trace(trace_info)

    calls = [c[0][0] for c in trace_instance.add_run.call_args_list]
    # workflow run is the root; trace_id must equal its run_id
    assert calls[0].id == "run-xyz"
    assert calls[0].trace_id == "run-xyz"
