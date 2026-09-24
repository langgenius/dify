import json
from collections.abc import Iterator
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.agent.errors import AgentMaxIterationError
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.app.entities.queue_entities import QueueMessageFileEvent
from core.credit_usage import CreditUsageAppType
from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageContentType,
    PromptMessageTool,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from libs.datetime_utils import naive_utc_now
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus
from models.model import AppMode, Conversation, Message, StorageType, UploadFile

# ==============================
# Dummy Helper Classes
# ==============================


def build_usage(pt=1, ct=1, tt=2) -> LLMUsage:
    usage = LLMUsage.empty_usage()
    usage.prompt_tokens = pt
    usage.completion_tokens = ct
    usage.total_tokens = tt
    usage.prompt_price = 0
    usage.completion_price = 0
    usage.total_price = 0
    return usage


def _make_conversation(*, conversation_id: str = "conv1") -> Conversation:
    return Conversation(
        id=conversation_id,
        app_id="app",
        mode=AppMode.AGENT_CHAT,
        name="Agent Conversation",
        inputs={},
        from_source=ConversationFromSource.API,
    )


def _make_message(*, message_id: str = "m1", conversation_id: str = "conv1") -> Message:
    return Message(
        id=message_id,
        app_id="app",
        conversation_id=conversation_id,
        inputs={},
        query="query",
        message={},
        answer="",
        status=MessageStatus.NORMAL,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        created_at=naive_utc_now(),
    )


class DummyMessage:
    def __init__(self, content: str | None = None, tool_calls: list[Any] | None = None):
        self.content: str | None = content
        self.tool_calls: list[Any] = tool_calls or []
        self.opaque_body = None


class DummyDelta:
    def __init__(self, message: DummyMessage | None = None, usage: LLMUsage | None = None):
        self.message: DummyMessage | None = message
        self.usage: LLMUsage | None = usage


class DummyChunk:
    def __init__(self, message: DummyMessage | None = None, usage: LLMUsage | None = None):
        self.delta: DummyDelta = DummyDelta(message=message, usage=usage)


class DummyResult:
    def __init__(
        self,
        message: DummyMessage | None = None,
        usage: LLMUsage | None = None,
        prompt_messages: list[DummyMessage] | None = None,
    ):
        self.message: DummyMessage | None = message
        self.usage: LLMUsage | None = usage
        self.prompt_messages: list[DummyMessage] = prompt_messages or []
        self.system_fingerprint: str = ""


# ==============================
# Fixtures
# ==============================


@pytest.fixture
def runner(mocker: MockerFixture, sqlite_engine: Engine) -> Iterator[FunctionCallAgentRunner]:
    # Completely bypass BaseAgentRunner __init__ to avoid DB / Flask context
    mocker.patch(
        "core.agent.base_agent_runner.BaseAgentRunner.__init__",
        return_value=None,
    )

    # Patch streaming chunk models to avoid validation on dummy message objects
    mocker.patch("core.agent.fc_agent_runner.LLMResultChunk", MagicMock)
    mocker.patch("core.agent.fc_agent_runner.LLMResultChunkDelta", MagicMock)

    app_config = MagicMock()
    app_config.app_id = "app"
    app_config.agent = MagicMock(max_iteration=2)
    app_config.prompt_template = MagicMock(simple_prompt_template="system")

    application_generate_entity = MagicMock()
    application_generate_entity.model_conf = MagicMock(parameters={}, stop=None)
    application_generate_entity.trace_manager = MagicMock()
    application_generate_entity.invoke_from = "test"
    application_generate_entity.app_config = MagicMock(app_id="app")
    application_generate_entity.file_upload_config = None

    queue_manager = MagicMock()
    model_instance = MagicMock()
    model_instance.model = "test-model"
    model_instance.model_name = "test-model"

    message = _make_message(message_id="msg1")
    conversation = _make_conversation()

    runner = FunctionCallAgentRunner(
        tenant_id="tenant",
        application_generate_entity=application_generate_entity,
        conversation=conversation,
        app_config=app_config,
        model_config=MagicMock(),
        config=MagicMock(),
        queue_manager=queue_manager,
        message=message,
        user_id="user",
        model_instance=model_instance,
    )

    # Manually inject required attributes normally set by BaseAgentRunner
    runner.tenant_id = "tenant"
    runner.application_generate_entity = application_generate_entity
    runner.conversation = conversation
    runner.app_config = app_config
    runner.model_config = MagicMock()
    runner.config = MagicMock()
    runner.queue_manager = queue_manager
    runner.message = message
    runner.user_id = "user"
    runner.model_instance = model_instance

    runner.stream_tool_call = False
    runner.memory = None
    runner.history_prompt_messages = []
    runner._current_thoughts = []
    runner.files = []
    runner.vision_enabled = False
    runner.agent_callback = MagicMock()
    runner.session = Session(sqlite_engine)

    runner._init_prompt_tools = MagicMock(return_value=({}, []))
    runner.create_agent_thought = MagicMock(return_value="thought1")
    runner.save_agent_thought = MagicMock()
    runner.model_config.model_schema.model_properties = {}
    runner.update_prompt_message_tool = MagicMock()

    try:
        yield runner
    finally:
        runner.session.close()


# ==============================
# Tool Call Checks
# ==============================


class TestToolCallChecks:
    @pytest.mark.parametrize(("tool_calls", "expected"), [([], False), ([MagicMock()], True)])
    def test_check_tool_calls(self, runner: FunctionCallAgentRunner, tool_calls, expected):
        chunk = DummyChunk(message=DummyMessage(tool_calls=tool_calls))
        assert runner.check_tool_calls(chunk) is expected

    @pytest.mark.parametrize(("tool_calls", "expected"), [([], False), ([MagicMock()], True)])
    def test_check_blocking_tool_calls(self, runner: FunctionCallAgentRunner, tool_calls, expected):
        result = DummyResult(message=DummyMessage(tool_calls=tool_calls))
        assert runner.check_blocking_tool_calls(result) is expected


# ==============================
# Extract Tool Calls
# ==============================


class TestExtractToolCalls:
    def test_extract_tool_calls_with_valid_json(self, runner: FunctionCallAgentRunner):
        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = json.dumps({"a": 1})

        chunk = DummyChunk(message=DummyMessage(tool_calls=[tool_call]))
        calls = runner.extract_tool_calls(chunk)

        assert calls == [("1", "tool", {"a": 1})]

    def test_extract_tool_calls_empty_arguments(self, runner: FunctionCallAgentRunner):
        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = ""

        chunk = DummyChunk(message=DummyMessage(tool_calls=[tool_call]))
        calls = runner.extract_tool_calls(chunk)

        assert calls == [("1", "tool", {})]

    def test_extract_blocking_tool_calls(self, runner: FunctionCallAgentRunner):
        tool_call = MagicMock()
        tool_call.id = "2"
        tool_call.function.name = "block"
        tool_call.function.arguments = json.dumps({"x": 2})

        result = DummyResult(message=DummyMessage(tool_calls=[tool_call]))
        calls = runner.extract_blocking_tool_calls(result)

        assert calls == [("2", "block", {"x": 2})]


# ==============================
# System Message Initialization
# ==============================


class TestInitSystemMessage:
    def test_init_system_message_empty_prompt_messages(self, runner: FunctionCallAgentRunner):
        result = runner._init_system_message("system", [])
        assert len(result) == 1

    def test_init_system_message_insert_at_start(self, runner: FunctionCallAgentRunner):
        msgs = [MagicMock()]
        result = runner._init_system_message("system", msgs)
        assert result[0].content == "system"

    def test_init_system_message_no_template(self, runner: FunctionCallAgentRunner):
        result = runner._init_system_message("", [])
        assert result == []


# ==============================
# Organize User Query
# ==============================


class TestOrganizeUserQuery:
    def test_without_files(self, runner: FunctionCallAgentRunner):
        result = runner._organize_user_query("query", [])
        assert len(result) == 1

    def test_with_none_query(self, runner: FunctionCallAgentRunner):
        result = runner._organize_user_query(None, [])
        assert len(result) == 1

    def test_with_files_uses_image_detail_config(self, runner: FunctionCallAgentRunner, mocker: MockerFixture):
        file_content = TextPromptMessageContent(data="file-content")
        mock_to_prompt = mocker.patch(
            "core.agent.fc_agent_runner.file_manager.to_prompt_message_content",
            return_value=file_content,
        )

        image_config = MagicMock(detail=ImagePromptMessageContent.DETAIL.HIGH)
        runner.application_generate_entity.file_upload_config = MagicMock(image_config=image_config)
        runner.files = ["file1"]

        result = runner._organize_user_query("query", [])

        assert len(result) == 1
        assert isinstance(result[0].content, list)
        mock_to_prompt.assert_called_once_with("file1", image_detail_config=ImagePromptMessageContent.DETAIL.HIGH)


class TestBuildDatasetToolImageContents:
    def test_returns_empty_when_vision_disabled(self, runner: FunctionCallAgentRunner):
        tool = MagicMock()
        tool.__class__.__name__ = "DatasetRetrieverTool"
        response = "![image](http://localhost:5001/files/890985e9-c2f1-484e-bc7b-62010a337e6d/file-preview)"

        assert runner._build_dataset_tool_image_contents(runner.session, response, tool) == []

    def test_builds_image_contents_from_dataset_tool_preview_links(
        self, runner: FunctionCallAgentRunner, mocker: MockerFixture
    ):
        from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool

        runner.vision_enabled = True
        image_content = ImagePromptMessageContent(format="url", mime_type="image/png")
        to_prompt_content = mocker.patch(
            "core.agent.fc_agent_runner.file_manager.to_prompt_message_content",
            return_value=image_content,
        )
        grant_access = mocker.patch("core.agent.fc_agent_runner.grant_upload_file_access")
        sign_preview = mocker.patch(
            "core.agent.fc_agent_runner.sign_upload_file_preview_url",
            return_value="http://localhost:5001/files/file-id/file-preview?sign=1",
        )
        build_reference = mocker.patch("core.agent.fc_agent_runner.build_file_reference", return_value="file-ref")

        upload_file = UploadFile(
            tenant_id="00000000-0000-0000-0000-000000000001",
            storage_type=StorageType.LOCAL,
            key="image_files/chart.png",
            name="chart.png",
            size=123,
            extension="png",
            mime_type="image/png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="00000000-0000-0000-0000-000000000002",
            created_at=datetime.now(UTC),
            used=True,
        )
        upload_file.id = "890985e9-c2f1-484e-bc7b-62010a337e6d"
        non_image_file = UploadFile(
            tenant_id=upload_file.tenant_id,
            storage_type=StorageType.LOCAL,
            key="files/report.pdf",
            name="report.pdf",
            size=10,
            extension="pdf",
            mime_type="application/pdf",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=upload_file.created_by,
            created_at=datetime.now(UTC),
            used=True,
        )
        non_image_file.id = "11111111-1111-1111-1111-111111111111"
        session = runner.session
        session.add_all([upload_file, non_image_file])
        session.commit()

        response = (
            "![image](http://localhost:5001/files/890985e9-c2f1-484e-bc7b-62010a337e6d/file-preview?sign=1)\n"
            "duplicate ![image](http://localhost:5001/files/890985e9-c2f1-484e-bc7b-62010a337e6d/file-preview)\n"
            "file ![file](http://localhost:5001/files/11111111-1111-1111-1111-111111111111/file-preview)"
        )

        tool = MagicMock(spec=DatasetRetrieverTool)
        contents = runner._build_dataset_tool_image_contents(session, response, tool)

        assert contents == [image_content]
        assert contents[0].type == PromptMessageContentType.IMAGE
        grant_access.assert_called_once()
        assert list(grant_access.call_args.args[0]) == ["890985e9-c2f1-484e-bc7b-62010a337e6d"]
        sign_preview.assert_called_once_with(upload_file.id, upload_file.extension)
        build_reference.assert_called_once_with(record_id=str(upload_file.id))
        to_prompt_content.assert_called_once()


# ==============================
# Run Method Tests
# ==============================


class TestRunMethod:
    @pytest.mark.parametrize("stream", [False, True])
    @pytest.mark.parametrize("second_snapshot", [{"responses_output": [{"type": "reasoning", "id": "r2"}]}, {}])
    def test_tool_loop_preserves_snapshots_and_initial_prefix(
        self, runner: FunctionCallAgentRunner, mocker: MockerFixture, stream: bool, second_snapshot: dict
    ):
        mocker.patch("core.agent.fc_agent_runner.LLMResultChunk", LLMResultChunk)
        mocker.patch("core.agent.fc_agent_runner.LLMResultChunkDelta", LLMResultChunkDelta)
        runner.stream_tool_call = stream
        runner.vision_enabled = True
        runner.files = ["original-image"]
        image = ImagePromptMessageContent(format="base64", mime_type="image/png", base64_data="aW1hZ2U=")
        convert_image = mocker.patch(
            "core.agent.fc_agent_runner.file_manager.to_prompt_message_content", return_value=image
        )
        history = [UserPromptMessage(content="earlier question"), AssistantPromptMessage(content="earlier answer")]
        transform = mocker.patch("core.agent.fc_agent_runner.AgentHistoryPromptTransform")
        transform.return_value.get_prompt.side_effect = [history, []]
        prompt_tool = PromptMessageTool(
            name="tool", description="original", parameters={"type": "object", "properties": {}}
        )
        runner._init_prompt_tools.return_value = ({"tool": MagicMock()}, [prompt_tool])
        first_snapshot = {"anthropic_content": [{"type": "thinking", "thinking": "summary", "signature": "sig1"}]}
        snapshots = [first_snapshot, second_snapshot, None]
        requests = []

        def invoke(**kwargs):
            requests.append(deepcopy(kwargs))
            index = len(requests) - 1
            calls = (
                [
                    AssistantPromptMessage.ToolCall(
                        id=f"call-{index}",
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="tool", arguments="{}"),
                    )
                ]
                if index < 2
                else []
            )
            response = AssistantPromptMessage(content=f"answer-{index}", tool_calls=calls, opaque_body=snapshots[index])
            if not stream:
                return LLMResult(model="test-model", message=response, usage=build_usage())

            def chunks():
                yield LLMResultChunk(model="test-model", delta=LLMResultChunkDelta(index=0, message=response))
                # Usage-only trailers must not replace a complete snapshot with None.
                yield LLMResultChunk(
                    model="test-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=""),
                        usage=build_usage(),
                    ),
                )

            return chunks()

        runner.model_instance.invoke_llm.side_effect = invoke

        def tool_invoke(**_kwargs):
            prompt_tool.description = "runtime schema changed"
            return "tool result", [], MagicMock(to_dict=lambda: {})

        mocker.patch("core.agent.fc_agent_runner.ToolEngine.agent_invoke", side_effect=tool_invoke)
        list(runner.run(runner.session, _make_message(), "query"))

        assert len(requests) == 3
        initial = requests[0]["prompt_messages"]
        for request in requests[1:]:
            assert request["prompt_messages"][: len(initial)] == initial
            assert request["tools"] == requests[0]["tools"]
        assert requests[2]["tools"][0].description == "original"
        assert requests[1]["prompt_messages"][len(initial)].opaque_body == first_snapshot
        assert requests[2]["prompt_messages"][len(initial) + 2].opaque_body == second_snapshot
        assert runner._current_thoughts[-1].opaque_body is None
        assert initial[-1].content[0].base64_data == "aW1hZ2U="
        transform.return_value.get_prompt.assert_called_once()
        convert_image.assert_called_once()
        runner.update_prompt_message_tool.assert_not_called()

    def test_context_exhaustion_stops_before_mutating_or_resending_history(self, runner: FunctionCallAgentRunner):
        runner.model_config.model_schema.model_properties = {"context_size": 1000}
        runner.model_config.model_schema.parameter_rules = [SimpleNamespace(name="max_tokens", use_template=None)]
        runner.model_config.parameters = {"max_tokens": 200}
        runner.application_generate_entity.model_conf.parameters = runner.model_config.parameters
        runner.model_instance.get_llm_num_tokens.side_effect = [100, 850]
        response = AssistantPromptMessage(
            content="",
            opaque_body={"state": "signed"},
            tool_calls=[
                AssistantPromptMessage.ToolCall(
                    id="call-1",
                    type="function",
                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="missing", arguments="{}"),
                )
            ],
        )
        runner.model_instance.invoke_llm.return_value = LLMResult(
            model="test-model", message=response, usage=build_usage()
        )

        with pytest.raises(InvokeBadRequestError, match="context window exhausted"):
            list(runner.run(runner.session, _make_message(), "query"))

        assert runner.model_instance.invoke_llm.call_count == 1
        assert runner._current_thoughts[0].opaque_body == {"state": "signed"}
        assert runner.model_config.parameters["max_tokens"] == 200
        assert runner.model_instance.get_llm_num_tokens.call_args.kwargs == {"tools": []}

    @pytest.mark.parametrize(
        ("parameter_name", "parameters", "output_budget"),
        [
            ("max_tokens", {"thinking": True, "thinking_budget": 1024, "max_tokens": 64000}, 64000),
            ("max_output_tokens", {"max_tokens": 64000}, 64000),
            ("max_output_tokens", {}, 64000),
            ("max_tokens", {"max_tokens": 1}, 1),
            ("max_output_tokens", {}, 1),
        ],
    )
    def test_context_check_preserves_configured_and_default_output_budget(
        self, runner: FunctionCallAgentRunner, parameter_name: str, parameters: dict, output_budget: int
    ):
        runner.model_config.model_schema.model_properties = {"context_size": 200000}
        runner.model_config.model_schema.parameter_rules = [
            SimpleNamespace(name=parameter_name, use_template="max_tokens", default=output_budget)
        ]
        runner.model_config.parameters = parameters.copy()
        runner.model_instance.get_llm_num_tokens.return_value = 200000 - output_budget + 1

        with pytest.raises(InvokeBadRequestError, match="prompt and output token budget do not fit"):
            runner._check_context_budget([UserPromptMessage(content="query")], [])

        assert runner.model_config.parameters == parameters

        for token_count in (-1, 200000 - output_budget):
            runner.model_instance.get_llm_num_tokens.return_value = token_count
            runner._check_context_budget([UserPromptMessage(content="query")], [])
        assert runner.model_config.parameters == parameters

    def test_history_window_is_selected_before_the_tool_loop(
        self, runner: FunctionCallAgentRunner, mocker: MockerFixture
    ):
        runner.memory = MagicMock()
        runner.history_prompt_messages = [
            UserPromptMessage(content="old"),
            AssistantPromptMessage(content="old answer"),
            UserPromptMessage(content="recent"),
            AssistantPromptMessage(content="recent answer"),
        ]
        runner.model_config.provider_model_bundle.model_type_instance.get_num_tokens.side_effect = (
            lambda _model, _credentials, messages: len(messages)
        )
        # Execute the real history selector; the initial budget admits only the
        # most recent complete user turn. A second selection would remove it.
        budget = mocker.patch.object(AgentHistoryPromptTransform, "_calculate_rest_token", side_effect=[3, 0])
        call = AssistantPromptMessage.ToolCall(
            id="call-1",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="missing", arguments="{}"),
        )
        requests = []

        def invoke(**kwargs):
            requests.append(deepcopy(kwargs["prompt_messages"]))
            return LLMResult(
                model="test-model",
                usage=build_usage(),
                message=AssistantPromptMessage(
                    content="answer",
                    tool_calls=[call] if len(requests) == 1 else [],
                    opaque_body={"state": "signed"},
                ),
            )

        runner.model_instance.invoke_llm.side_effect = invoke
        list(runner.run(runner.session, _make_message(), "query"))

        assert [message.content for message in requests[0]] == ["system", "recent", "recent answer", "query"]
        assert requests[1][: len(requests[0])] == requests[0]
        budget.assert_called_once()

    def test_interrupted_stream_does_not_save_or_replay_partial_snapshot(self, runner: FunctionCallAgentRunner):
        runner.stream_tool_call = True

        def interrupted():
            yield LLMResultChunk(
                model="test-model",
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(content="partial", opaque_body={"state": "partial"}),
                ),
            )
            raise ConnectionError("stream interrupted")

        runner.model_instance.invoke_llm.return_value = interrupted()
        with pytest.raises(ConnectionError, match="stream interrupted"):
            list(runner.run(runner.session, _make_message(), "query"))
        assert runner._current_thoughts == []
        assert runner.model_instance.invoke_llm.call_count == 1

    def test_run_non_streaming_no_tool_calls(self, runner: FunctionCallAgentRunner):
        message = _make_message()
        dummy_message = DummyMessage(content="hello")
        result = DummyResult(message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        outputs = list(runner.run(runner.session, message, "query"))
        assert len(outputs) == 1
        assert "session" not in runner.create_agent_thought.call_args.kwargs
        assert "session" not in runner.save_agent_thought.call_args.kwargs
        assert runner.model_instance.invoke_llm.call_args.kwargs["request_metadata"] == {
            "app_id": "app",
            "app_type": CreditUsageAppType.AGENT,
            "created_by": CreditUsageCreatedBy.APP.value,
        }
        runner.queue_manager.publish.assert_called()

        queue_calls = runner.queue_manager.publish.call_args_list
        assert any(call.args and call.args[0].__class__.__name__ == "QueueMessageEndEvent" for call in queue_calls)

    def test_run_streaming_branch(self, runner: FunctionCallAgentRunner):
        runner.stream_tool_call = True
        events: list[str] = []
        session = runner.session
        conversation = _make_conversation()
        message = _make_message(conversation_id=conversation.id)
        session.add_all([conversation, message])
        session.commit()

        def record_commit(_session: Session) -> None:
            events.append("commit")

        def record_detach(_session: Session, instance: object) -> None:
            if instance is message:
                events.append("close")

        event.listen(session, "after_commit", record_commit)
        event.listen(session, "persistent_to_detached", record_detach)

        content = [TextPromptMessageContent(data="hi")]
        chunk = DummyChunk(message=DummyMessage(content=content), usage=build_usage())

        def generator():
            events.append("first-chunk")
            yield chunk

        runner.model_instance.invoke_llm.return_value = generator()

        outputs = list(runner.run(session, message, "query"))
        assert events == ["commit", "close", "first-chunk"]
        assert len(outputs) == 1

    def test_run_streaming_tool_calls_list_content(self, runner: FunctionCallAgentRunner):
        message = _make_message()
        runner.stream_tool_call = True

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = json.dumps({"a": 1})

        content = [TextPromptMessageContent(data="hi")]
        chunk = DummyChunk(message=DummyMessage(content=content, tool_calls=[tool_call]), usage=build_usage())

        def generator():
            yield chunk

        final_message = DummyMessage(content="done", tool_calls=[])
        final_result = DummyResult(message=final_message, usage=build_usage())

        runner.model_instance.invoke_llm.side_effect = [generator(), final_result]

        outputs = list(runner.run(runner.session, message, "query"))
        assert len(outputs) >= 1

    def test_run_non_streaming_list_content(self, runner: FunctionCallAgentRunner):
        message = _make_message()
        content = [TextPromptMessageContent(data="hi")]
        dummy_message = DummyMessage(content=content)
        result = DummyResult(message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        outputs = list(runner.run(runner.session, message, "query"))
        assert len(outputs) == 1
        assert runner.save_agent_thought.call_args.kwargs["thought"] == "hi"

    def test_run_streaming_tool_call_inputs_type_error(self, runner: FunctionCallAgentRunner, mocker: MockerFixture):
        message = _make_message()
        runner.stream_tool_call = True

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = json.dumps({"a": 1})

        chunk = DummyChunk(message=DummyMessage(content="hi", tool_calls=[tool_call]), usage=build_usage())

        def generator():
            yield chunk

        runner.model_instance.invoke_llm.return_value = generator()

        real_dumps = json.dumps

        def flaky_dumps(obj, *args, **kwargs):
            if kwargs.get("ensure_ascii") is False:
                return real_dumps(obj, *args, **kwargs)
            raise TypeError("boom")

        mocker.patch("core.agent.fc_agent_runner.json.dumps", side_effect=flaky_dumps)

        outputs = list(runner.run(runner.session, message, "query"))
        assert len(outputs) == 1

    def test_run_with_missing_tool_instance(self, runner: FunctionCallAgentRunner):
        message = _make_message()

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "missing"
        tool_call.function.arguments = json.dumps({})

        dummy_message = DummyMessage(content="", tool_calls=[tool_call])
        result = DummyResult(message=dummy_message, usage=build_usage())
        final_message = DummyMessage(content="done", tool_calls=[])
        final_result = DummyResult(message=final_message, usage=build_usage())

        runner.model_instance.invoke_llm.side_effect = [result, final_result]

        outputs = list(runner.run(runner.session, message, "query"))
        assert len(outputs) >= 1

    def test_run_with_tool_instance_and_files(self, runner: FunctionCallAgentRunner, mocker: MockerFixture):
        message = _make_message()

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = json.dumps({"a": 1})

        dummy_message = DummyMessage(content="", tool_calls=[tool_call])
        result = DummyResult(message=dummy_message, usage=build_usage())
        final_result = DummyResult(message=DummyMessage(content="done", tool_calls=[]), usage=build_usage())

        runner.model_instance.invoke_llm.side_effect = [result, final_result]

        tool_instance = MagicMock()
        prompt_tool = MagicMock()
        prompt_tool.name = "tool"
        runner._init_prompt_tools.return_value = ({"tool": tool_instance}, [prompt_tool])

        tool_invoke_meta = MagicMock()
        tool_invoke_meta.to_dict.return_value = {"ok": True}
        mocker.patch(
            "core.agent.fc_agent_runner.ToolEngine.agent_invoke",
            return_value=("ok", ["file1"], tool_invoke_meta),
        )

        outputs = list(runner.run(runner.session, message, "query"))
        assert len(outputs) >= 1
        assert any(
            isinstance(call.args[0], QueueMessageFileEvent)
            and call.args[0].message_file_id == "file1"
            and call.args[1] == PublishFrom.APPLICATION_MANAGER
            for call in runner.queue_manager.publish.call_args_list
        )

    def test_run_max_iteration_error(self, runner: FunctionCallAgentRunner):
        runner.app_config.agent.max_iteration = 0

        message = _make_message()

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = "{}"

        dummy_message = DummyMessage(content="", tool_calls=[tool_call])
        result = DummyResult(message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        with pytest.raises(AgentMaxIterationError):
            list(runner.run(runner.session, message, "query"))
