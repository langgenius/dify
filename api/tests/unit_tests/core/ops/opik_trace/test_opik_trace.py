import collections
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey

from core.ops.entities.config_entity import OpikConfig
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
from core.ops.opik_trace.opik_trace import OpikDataTrace, prepare_opik_uuid, wrap_dict, wrap_metadata
from models import EndUser
from models.enums import MessageStatus


def _dt() -> datetime:
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def opik_config():
    return OpikConfig(
        project="test-project", workspace="test-workspace", url="https://cloud.opik.com/api/", api_key="api-key-123"
    )


@pytest.fixture
def trace_instance(opik_config, monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.Opik", lambda **kwargs: mock_client)

    instance = OpikDataTrace(opik_config)
    return instance


def test_wrap_dict():
    assert wrap_dict("input", {"a": 1}) == {"a": 1}
    assert wrap_dict("input", "hello") == {"input": "hello"}


def test_wrap_metadata():
    assert wrap_metadata({"a": 1}, b=2) == {"a": 1, "b": 2, "created_from": "dify"}


def test_prepare_opik_uuid():
    # Test with valid datetime and uuid string
    dt = datetime(2024, 1, 1)
    uuid_str = "b3e8e918-472e-4b69-8051-12502c34fc07"
    result = prepare_opik_uuid(dt, uuid_str)
    assert result is not None
    # We won't test the exact uuid7 value but just that it returns a string id

    # Test with None dt and uuid_str
    result = prepare_opik_uuid(None, None)
    assert result is not None


def test_init(opik_config, monkeypatch):
    mock_opik = MagicMock()
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.Opik", mock_opik)
    monkeypatch.setenv("FILES_URL", "http://test.url")

    instance = OpikDataTrace(opik_config)

    mock_opik.assert_called_once_with(
        project_name=opik_config.project,
        workspace=opik_config.workspace,
        host=opik_config.url,
        api_key=opik_config.api_key,
    )
    assert instance.file_base_url == "http://test.url"
    assert instance.project == opik_config.project


def test_trace_dispatch(trace_instance, monkeypatch):
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


def test_workflow_trace_with_message_id(trace_instance, monkeypatch):
    # Define constants for better readability
    WORKFLOW_ID = "fb05c7cd-6cec-4add-8a84-df03a408b4ce"
    WORKFLOW_RUN_ID = "33c67568-7a8a-450e-8916-a5f135baeaef"
    MESSAGE_ID = "04ec3956-85f3-488a-8539-1017251dc8c6"
    CONVERSATION_ID = "d3d01066-23ae-4830-9ce4-eb5640b42a7e"
    TRACE_ID = "bf26d929-6f15-4c2f-9abc-761c217056f3"
    WORKFLOW_APP_LOG_ID = "ca0e018e-edd4-43fb-a05a-ea001ca8ef4b"
    LLM_NODE_ID = "80d7dfa8-08f4-4ab7-aa37-0ca7d27207e3"
    CODE_NODE_ID = "b9cd9a7b-c534-4aa9-b5da-efd454140900"

    trace_info = WorkflowTraceInfo(
        workflow_id=WORKFLOW_ID,
        tenant_id="tenant-1",
        workflow_run_id=WORKFLOW_RUN_ID,
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={"input": "hi"},
        workflow_run_outputs={"output": "hello"},
        workflow_run_version="1.0",
        message_id=MESSAGE_ID,
        conversation_id=CONVERSATION_ID,
        total_tokens=100,
        file_list=[],
        query="hi",
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id=TRACE_ID,
        metadata={"app_id": "app-1", "user_id": "user-1"},
        workflow_app_log_id=WORKFLOW_APP_LOG_ID,
        error="",
    )

    mock_session = MagicMock()
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.sessionmaker", lambda bind: lambda: mock_session)
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.db", MagicMock(engine="engine"))

    node_llm = MagicMock()
    node_llm.id = LLM_NODE_ID
    node_llm.title = "LLM Node"
    node_llm.node_type = BuiltinNodeTypes.LLM
    node_llm.status = "succeeded"
    node_llm.process_data = {
        "model_mode": "chat",
        "model_name": "gpt-4",
        "model_provider": "openai",
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    }
    node_llm.inputs = {"prompts": "p"}
    node_llm.outputs = {"text": "t"}
    node_llm.created_at = _dt()
    node_llm.elapsed_time = 0.5
    node_llm.metadata = {"foo": "bar"}

    node_other = MagicMock()
    node_other.id = CODE_NODE_ID
    node_other.title = "Other Node"
    node_other.node_type = BuiltinNodeTypes.CODE
    node_other.status = "failed"
    node_other.process_data = None
    node_other.inputs = {"code": "print"}
    node_other.outputs = {"result": "ok"}
    node_other.created_at = None
    node_other.elapsed_time = 0.2
    node_other.metadata = {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS.value: 10}

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = [node_llm, node_other]

    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.DifyCoreRepositoryFactory", mock_factory)

    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_trace = MagicMock()
    trace_instance.add_span = MagicMock()

    trace_instance.workflow_trace(trace_info)

    trace_instance.add_trace.assert_called_once()
    trace_data = trace_instance.add_trace.call_args[1].get("opik_trace_data", trace_instance.add_trace.call_args[0][0])
    assert trace_data["name"] == TraceTaskName.MESSAGE_TRACE
    assert "message" in trace_data["tags"]
    assert "workflow" in trace_data["tags"]

    assert trace_instance.add_span.call_count >= 1


def test_workflow_trace_no_message_id(trace_instance, monkeypatch):
    # Define constants for better readability
    WORKFLOW_ID = "f0708b36-b1d7-42b3-a876-1d01b7d8f1a3"
    WORKFLOW_RUN_ID = "d42ec285-c2fd-4248-8866-5c9386b101ac"
    CONVERSATION_ID = "88a17f2e-9436-4472-bab9-4b1601d5af3c"
    WORKFLOW_APP_LOG_ID = "41780d0d-ffba-4220-bc0c-401e4c89cdfb"

    trace_info = WorkflowTraceInfo(
        workflow_id=WORKFLOW_ID,
        tenant_id="tenant-1",
        workflow_run_id=WORKFLOW_RUN_ID,
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1.0",
        total_tokens=0,
        file_list=[],
        query="",
        message_id=None,
        conversation_id=CONVERSATION_ID,
        start_time=_dt(),
        end_time=_dt(),
        trace_id=None,
        metadata={"app_id": "app-1"},
        workflow_app_log_id=WORKFLOW_APP_LOG_ID,
        error="",
    )

    monkeypatch.setattr("core.ops.opik_trace.opik_trace.sessionmaker", lambda bind: lambda: MagicMock())
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.db", MagicMock(engine="engine"))
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.DifyCoreRepositoryFactory", mock_factory)
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_trace = MagicMock()
    trace_instance.workflow_trace(trace_info)

    trace_instance.add_trace.assert_called_once()


def test_workflow_trace_missing_app_id(trace_instance, monkeypatch):
    trace_info = WorkflowTraceInfo(
        workflow_id="5745f1b8-f8e6-4859-8110-996acb6c8d6a",
        tenant_id="tenant-1",
        workflow_run_id="46f53304-1659-464b-bee5-116585f0bec8",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1.0",
        total_tokens=0,
        file_list=[],
        query="",
        message_id=None,
        conversation_id="83f86b89-caef-4de8-a0f9-f164eddae1ea",
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        workflow_app_log_id="339760b2-4b94-4532-8c81-133a97e4680e",
        error="",
    )
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.sessionmaker", lambda bind: lambda: MagicMock())
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.db", MagicMock(engine="engine"))

    with pytest.raises(ValueError, match="No app_id found in trace_info metadata"):
        trace_instance.workflow_trace(trace_info)


def test_message_trace_basic(trace_instance, monkeypatch):
    # Define constants for better readability
    MESSAGE_DATA_ID = "e3a26712-8cac-4a25-94a4-a3bff21ee3ab"
    CONVERSATION_ID = "9d3f3751-7521-4c19-9307-20e3cf6789a3"
    MESSAGE_TRACE_ID = "710ace2f-bca8-41be-858c-54da42742a77"
    OPIT_TRACE_ID = "f7dfd978-0d10-4549-8abf-00f2cbc49d2c"

    message_data = MagicMock()
    message_data.id = MESSAGE_DATA_ID
    message_data.from_account_id = "acc-1"
    message_data.from_end_user_id = None
    message_data.provider_response_latency = 0.5
    message_data.conversation_id = CONVERSATION_ID
    message_data.total_price = 0.01
    message_data.model_id = "gpt-4"
    message_data.answer = "hello"
    message_data.status = MessageStatus.NORMAL
    message_data.error = None

    trace_info = MessageTraceInfo(
        message_id=MESSAGE_TRACE_ID,
        message_data=message_data,
        inputs={"query": "hi"},
        outputs={"answer": "hello"},
        message_tokens=10,
        answer_tokens=20,
        total_tokens=30,
        start_time=_dt(),
        end_time=_dt() + timedelta(seconds=1),
        trace_id=OPIT_TRACE_ID,
        metadata={"foo": "bar"},
        conversation_mode="chat",
        conversation_model="gpt-4",
        file_list=[],
        error=None,
        message_file_data=MagicMock(url="test.png"),
    )

    trace_instance.add_trace = MagicMock(return_value=MagicMock(id="trace_id_1"))
    trace_instance.add_span = MagicMock()

    trace_instance.message_trace(trace_info)

    trace_instance.add_trace.assert_called_once()
    trace_instance.add_span.assert_called_once()


def test_message_trace_with_end_user(trace_instance, monkeypatch):
    message_data = MagicMock()
    message_data.id = "85411059-79fb-4deb-a76c-c2e215f1b97e"
    message_data.from_account_id = "acc-1"
    message_data.from_end_user_id = "end-user-1"
    message_data.conversation_id = "7d9f96d8-3be2-4e93-9c0e-922ff98dccc6"
    message_data.status = MessageStatus.NORMAL
    message_data.model_id = "gpt-4"
    message_data.error = ""
    message_data.answer = "hello"
    message_data.total_price = 0.0
    message_data.provider_response_latency = 0.1

    trace_info = MessageTraceInfo(
        message_id="6bff35c7-33b7-4acb-ba21-44569a0327d0",
        message_data=message_data,
        inputs={},
        outputs={},
        message_tokens=0,
        answer_tokens=0,
        total_tokens=0,
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        conversation_mode="chat",
        conversation_model="gpt-4",
        file_list=["url1"],
        error=None,
    )

    mock_end_user = MagicMock(spec=EndUser)
    mock_end_user.session_id = "session-id-123"

    monkeypatch.setattr("core.ops.opik_trace.opik_trace.db.session.get", lambda model, pk: mock_end_user)

    trace_instance.add_trace = MagicMock(return_value=MagicMock(id="trace_id_2"))
    trace_instance.add_span = MagicMock()

    trace_instance.message_trace(trace_info)

    trace_data = trace_instance.add_trace.call_args[0][0]
    assert trace_data["metadata"]["user_id"] == "acc-1"
    assert trace_data["metadata"]["end_user_id"] == "session-id-123"


def test_message_trace_none_data(trace_instance):
    trace_info = SimpleNamespace(message_data=None, file_list=[], message_file_data=None, metadata={})
    trace_instance.add_trace = MagicMock()
    trace_instance.message_trace(trace_info)
    trace_instance.add_trace.assert_not_called()


def test_moderation_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = ModerationTraceInfo(
        message_id="489d0dfd-065c-4106-8f9c-daded296c92d",
        message_data=message_data,
        inputs={"q": "hi"},
        action="stop",
        flagged=True,
        preset_response="blocked",
        start_time=None,
        end_time=None,
        metadata={"foo": "bar"},
        trace_id="6f16cf18-9f4b-4955-8b6b-43cfa10978fc",
        query="hi",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.moderation_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[0][0]
    assert span_data["name"] == TraceTaskName.MODERATION_TRACE
    assert span_data["output"]["flagged"] is True


def test_moderation_trace_none(trace_instance):
    trace_info = ModerationTraceInfo(
        message_id="cd732e4e-37f1-4c7e-8c64-820308bedcbf",
        message_data=None,
        inputs={},
        action="s",
        flagged=False,
        preset_response="",
        query="",
        metadata={},
    )
    trace_instance.add_span = MagicMock()
    trace_instance.moderation_trace(trace_info)
    trace_instance.add_span.assert_not_called()


def test_suggested_question_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = SuggestedQuestionTraceInfo(
        message_id="7de55bda-a91d-477e-98ab-85c53c438469",
        message_data=message_data,
        inputs="hi",
        suggested_question=["q1"],
        total_tokens=10,
        level="info",
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        trace_id="a6687292-68c7-42ba-ae51-285579944d7b",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.suggested_question_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[0][0]
    assert span_data["name"] == TraceTaskName.SUGGESTED_QUESTION_TRACE


def test_suggested_question_trace_none(trace_instance):
    trace_info = SuggestedQuestionTraceInfo(
        message_id="23696fc5-7e7f-46ec-bce8-1adc3c7f297d",
        message_data=None,
        inputs={},
        suggested_question=[],
        total_tokens=0,
        level="i",
        metadata={},
    )
    trace_instance.add_span = MagicMock()
    trace_instance.suggested_question_trace(trace_info)
    trace_instance.add_span.assert_not_called()


def test_dataset_retrieval_trace(trace_instance):
    message_data = MagicMock()
    message_data.created_at = _dt()
    message_data.updated_at = _dt()

    trace_info = DatasetRetrievalTraceInfo(
        message_id="3e1a819f-c391-4950-adfd-96f82e5419a1",
        message_data=message_data,
        inputs="query",
        documents=[{"id": "doc1"}],
        start_time=None,
        end_time=None,
        metadata={},
        trace_id="41361000-e9be-4d11-b5e4-ab27ce0817d6",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.dataset_retrieval_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[0][0]
    assert span_data["name"] == TraceTaskName.DATASET_RETRIEVAL_TRACE


def test_dataset_retrieval_trace_none(trace_instance):
    trace_info = DatasetRetrievalTraceInfo(
        message_id="35d6d44c-bccb-4e6e-8bd8-859257723ea8", message_data=None, inputs={}, documents=[], metadata={}
    )
    trace_instance.add_span = MagicMock()
    trace_instance.dataset_retrieval_trace(trace_info)
    trace_instance.add_span.assert_not_called()


def test_tool_trace(trace_instance):
    trace_info = ToolTraceInfo(
        message_id="99db92c4-2254-496a-b5cc-18153315ce35",
        message_data=MagicMock(),
        inputs={},
        outputs={},
        tool_name="my_tool",
        tool_inputs={"a": 1},
        tool_outputs="result_string",
        time_cost=0.1,
        start_time=_dt(),
        end_time=_dt(),
        metadata={},
        trace_id="a15a5fcb-7ffd-4458-8330-208f4cb1f796",
        tool_config={},
        tool_parameters={},
        error="some error",
    )

    trace_instance.add_span = MagicMock()
    trace_instance.tool_trace(trace_info)

    trace_instance.add_span.assert_called_once()
    span_data = trace_instance.add_span.call_args[0][0]
    assert span_data["name"] == "my_tool"


def test_generate_name_trace(trace_instance):
    trace_info = GenerateNameTraceInfo(
        inputs={"q": "hi"},
        outputs={"name": "new"},
        tenant_id="tenant-1",
        conversation_id="271fe28f-6b86-416b-8d6b-bbbbfa9db791",
        start_time=_dt(),
        end_time=_dt(),
        metadata={"921f010e-6878-4831-ae6b-271bf68c56fb": 1},
    )

    trace_instance.add_trace = MagicMock(return_value=MagicMock(id="trace_id_3"))
    trace_instance.add_span = MagicMock()

    trace_instance.generate_name_trace(trace_info)

    trace_instance.add_trace.assert_called_once()
    trace_instance.add_span.assert_called_once()

    trace_data = trace_instance.add_trace.call_args[0][0]
    assert trace_data["name"] == TraceTaskName.GENERATE_NAME_TRACE

    span_data = trace_instance.add_span.call_args[0][0]
    assert span_data["trace_id"] == "trace_id_3"


def test_add_trace_success(trace_instance):
    trace_data = {"id": "t1", "name": "trace"}
    trace_instance.opik_client.trace.return_value = MagicMock(id="t1")
    trace = trace_instance.add_trace(trace_data)
    trace_instance.opik_client.trace.assert_called_once()
    assert trace.id == "t1"


def test_add_trace_error(trace_instance):
    trace_instance.opik_client.trace.side_effect = Exception("error")
    trace_data = {"id": "t1", "name": "trace"}
    with pytest.raises(ValueError, match="Opik Failed to create trace: error"):
        trace_instance.add_trace(trace_data)


def test_add_span_success(trace_instance):
    span_data = {"id": "s1", "name": "span", "trace_id": "t1"}
    trace_instance.add_span(span_data)
    trace_instance.opik_client.span.assert_called_once()


def test_add_span_error(trace_instance):
    trace_instance.opik_client.span.side_effect = Exception("error")
    span_data = {"id": "s1", "name": "span", "trace_id": "t1"}
    with pytest.raises(ValueError, match="Opik Failed to create span: error"):
        trace_instance.add_span(span_data)


def test_api_check_success(trace_instance):
    trace_instance.opik_client.auth_check.return_value = True
    assert trace_instance.api_check() is True


def test_api_check_error(trace_instance):
    trace_instance.opik_client.auth_check.side_effect = Exception("fail")
    with pytest.raises(ValueError, match="Opik API check failed: fail"):
        trace_instance.api_check()


def test_get_project_url_success(trace_instance):
    trace_instance.opik_client.get_project_url.return_value = "http://project.url"
    assert trace_instance.get_project_url() == "http://project.url"
    trace_instance.opik_client.get_project_url.assert_called_once_with(project_name=trace_instance.project)


def test_get_project_url_error(trace_instance):
    trace_instance.opik_client.get_project_url.side_effect = Exception("fail")
    with pytest.raises(ValueError, match="Opik get run url failed: fail"):
        trace_instance.get_project_url()


def test_workflow_trace_usage_extraction_error_fixed(trace_instance, monkeypatch, caplog):
    trace_info = WorkflowTraceInfo(
        workflow_id="86a52565-4a6b-4a1b-9bfd-98e4595e70de",
        tenant_id="66e8e918-472e-4b69-8051-12502c34fc07",
        workflow_run_id="8403965c-3344-4d22-a8fe-d8d55cee64d9",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="s",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="",
        message_id=None,
        conversation_id="7a02cb9d-6949-4c59-a89d-f25bbc881e0e",
        start_time=_dt(),
        end_time=_dt(),
        metadata={"app_id": "77e8e918-472e-4b69-8051-12502c34fc07"},
        workflow_app_log_id="82268424-e193-476c-a6db-f473388ee5fe",
        error="",
    )

    node = MagicMock()
    node.id = "88e8e918-472e-4b69-8051-12502c34fc07"
    node.title = "LLM Node"
    node.node_type = BuiltinNodeTypes.LLM
    node.status = "succeeded"

    class BadDict(collections.UserDict):
        def get(self, key, default=None):
            if key == "usage":
                raise Exception("Usage extraction failed")
            return super().get(key, default)

    node.process_data = BadDict({"model_mode": "chat", "model_name": "gpt-4", "usage": True, "prompts": ["p"]})
    node.created_at = _dt()
    node.elapsed_time = 0.1
    node.metadata = {}
    node.outputs = {}

    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = [node]
    mock_factory = MagicMock()
    mock_factory.create_workflow_node_execution_repository.return_value = repo
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.DifyCoreRepositoryFactory", mock_factory)
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.sessionmaker", lambda bind: lambda: MagicMock())
    monkeypatch.setattr("core.ops.opik_trace.opik_trace.db", MagicMock(engine="engine"))
    monkeypatch.setattr(trace_instance, "get_service_account_with_tenant", lambda app_id: MagicMock())

    trace_instance.add_trace = MagicMock()
    trace_instance.add_span = MagicMock()

    with caplog.at_level(logging.ERROR):
        trace_instance.workflow_trace(trace_info)

    assert "Failed to extract usage" in caplog.text
    assert trace_instance.add_span.call_count >= 1
    # Verify that at least one of the spans is for the LLM Node
    span_names = [call.args[0]["name"] for call in trace_instance.add_span.call_args_list]
    assert "LLM Node" in span_names
