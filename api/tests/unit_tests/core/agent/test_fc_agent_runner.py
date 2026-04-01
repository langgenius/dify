import json
from typing import Any
from unittest.mock import MagicMock

import pytest
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import (
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)

from core.agent.errors import AgentMaxIterationError
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueMessageFileEvent

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


class DummyMessage:
    def __init__(self, content: str | None = None, tool_calls: list[Any] | None = None):
        self.content: str | None = content
        self.tool_calls: list[Any] = tool_calls or []


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
def runner(mocker):
    # Completely bypass BaseAgentRunner __init__ to avoid DB / Flask context
    mocker.patch(
        "core.agent.base_agent_runner.BaseAgentRunner.__init__",
        return_value=None,
    )

    # Patch streaming chunk models to avoid validation on dummy message objects
    mocker.patch("core.agent.fc_agent_runner.LLMResultChunk", MagicMock)
    mocker.patch("core.agent.fc_agent_runner.LLMResultChunkDelta", MagicMock)

    app_config = MagicMock()
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

    message = MagicMock(id="msg1")
    conversation = MagicMock(id="conv1")

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
    runner.agent_callback = MagicMock()

    runner._init_prompt_tools = MagicMock(return_value=({}, []))
    runner.create_agent_thought = MagicMock(return_value="thought1")
    runner.save_agent_thought = MagicMock()
    runner.recalc_llm_max_tokens = MagicMock()
    runner.update_prompt_message_tool = MagicMock()

    return runner


# ==============================
# Tool Call Checks
# ==============================


class TestToolCallChecks:
    @pytest.mark.parametrize(("tool_calls", "expected"), [([], False), ([MagicMock()], True)])
    def test_check_tool_calls(self, runner, tool_calls, expected):
        chunk = DummyChunk(message=DummyMessage(tool_calls=tool_calls))
        assert runner.check_tool_calls(chunk) is expected

    @pytest.mark.parametrize(("tool_calls", "expected"), [([], False), ([MagicMock()], True)])
    def test_check_blocking_tool_calls(self, runner, tool_calls, expected):
        result = DummyResult(message=DummyMessage(tool_calls=tool_calls))
        assert runner.check_blocking_tool_calls(result) is expected


# ==============================
# Extract Tool Calls
# ==============================


class TestExtractToolCalls:
    def test_extract_tool_calls_with_valid_json(self, runner):
        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = json.dumps({"a": 1})

        chunk = DummyChunk(message=DummyMessage(tool_calls=[tool_call]))
        calls = runner.extract_tool_calls(chunk)

        assert calls == [("1", "tool", {"a": 1})]

    def test_extract_tool_calls_empty_arguments(self, runner):
        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = ""

        chunk = DummyChunk(message=DummyMessage(tool_calls=[tool_call]))
        calls = runner.extract_tool_calls(chunk)

        assert calls == [("1", "tool", {})]

    def test_extract_blocking_tool_calls(self, runner):
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
    def test_init_system_message_empty_prompt_messages(self, runner):
        result = runner._init_system_message("system", [])
        assert len(result) == 1

    def test_init_system_message_insert_at_start(self, runner):
        msgs = [MagicMock()]
        result = runner._init_system_message("system", msgs)
        assert result[0].content == "system"

    def test_init_system_message_no_template(self, runner):
        result = runner._init_system_message("", [])
        assert result == []


# ==============================
# Organize User Query
# ==============================


class TestOrganizeUserQuery:
    def test_without_files(self, runner):
        result = runner._organize_user_query("query", [])
        assert len(result) == 1

    def test_with_none_query(self, runner):
        result = runner._organize_user_query(None, [])
        assert len(result) == 1

    def test_with_files_uses_image_detail_config(self, runner, mocker):
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


# ==============================
# Clear User Prompt Images
# ==============================


class TestClearUserPromptImageMessages:
    def test_clear_text_and_image_content(self, runner):
        text = MagicMock()
        text.type = "text"
        text.data = "hello"

        image = MagicMock()
        image.type = "image"
        image.data = "img"

        user_msg = MagicMock()
        user_msg.__class__.__name__ = "UserPromptMessage"
        user_msg.content = [text, image]

        result = runner._clear_user_prompt_image_messages([user_msg])
        assert isinstance(result, list)

    def test_clear_includes_file_placeholder(self, runner):
        text = TextPromptMessageContent(data="hello")
        image = ImagePromptMessageContent(format="url", mime_type="image/png")
        document = DocumentPromptMessageContent(format="url", mime_type="application/pdf")

        user_msg = UserPromptMessage(content=[text, image, document])

        result = runner._clear_user_prompt_image_messages([user_msg])

        assert result[0].content == "hello\n[image]\n[file]"


# ==============================
# Run Method Tests
# ==============================


class TestRunMethod:
    def test_run_non_streaming_no_tool_calls(self, runner):
        message = MagicMock(id="m1")
        dummy_message = DummyMessage(content="hello")
        result = DummyResult(message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        outputs = list(runner.run(message, "query"))
        assert len(outputs) == 1
        runner.queue_manager.publish.assert_called()

        queue_calls = runner.queue_manager.publish.call_args_list
        assert any(call.args and call.args[0].__class__.__name__ == "QueueMessageEndEvent" for call in queue_calls)

    def test_run_streaming_branch(self, runner):
        message = MagicMock(id="m1")
        runner.stream_tool_call = True

        content = [TextPromptMessageContent(data="hi")]
        chunk = DummyChunk(message=DummyMessage(content=content), usage=build_usage())

        def generator():
            yield chunk

        runner.model_instance.invoke_llm.return_value = generator()

        outputs = list(runner.run(message, "query"))
        assert len(outputs) == 1

    def test_run_streaming_tool_calls_list_content(self, runner):
        message = MagicMock(id="m1")
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

        outputs = list(runner.run(message, "query"))
        assert len(outputs) >= 1

    def test_run_non_streaming_list_content(self, runner):
        message = MagicMock(id="m1")
        content = [TextPromptMessageContent(data="hi")]
        dummy_message = DummyMessage(content=content)
        result = DummyResult(message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        outputs = list(runner.run(message, "query"))
        assert len(outputs) == 1
        assert runner.save_agent_thought.call_args.kwargs["thought"] == "hi"

    def test_run_streaming_tool_call_inputs_type_error(self, runner, mocker):
        message = MagicMock(id="m1")
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

        outputs = list(runner.run(message, "query"))
        assert len(outputs) == 1

    def test_run_with_missing_tool_instance(self, runner):
        message = MagicMock(id="m1")

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "missing"
        tool_call.function.arguments = json.dumps({})

        dummy_message = DummyMessage(content="", tool_calls=[tool_call])
        result = DummyResult(message=dummy_message, usage=build_usage())
        final_message = DummyMessage(content="done", tool_calls=[])
        final_result = DummyResult(message=final_message, usage=build_usage())

        runner.model_instance.invoke_llm.side_effect = [result, final_result]

        outputs = list(runner.run(message, "query"))
        assert len(outputs) >= 1

    def test_run_with_tool_instance_and_files(self, runner, mocker):
        message = MagicMock(id="m1")

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

        outputs = list(runner.run(message, "query"))
        assert len(outputs) >= 1
        assert any(
            isinstance(call.args[0], QueueMessageFileEvent)
            and call.args[0].message_file_id == "file1"
            and call.args[1] == PublishFrom.APPLICATION_MANAGER
            for call in runner.queue_manager.publish.call_args_list
        )

    def test_run_max_iteration_error(self, runner):
        runner.app_config.agent.max_iteration = 0

        message = MagicMock(id="m1")

        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = "{}"

        dummy_message = DummyMessage(content="", tool_calls=[tool_call])
        result = DummyResult(message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        with pytest.raises(AgentMaxIterationError):
            list(runner.run(message, "query"))
