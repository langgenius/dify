import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from core.agent.errors import AgentMaxIterationError
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueMessageFileEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import (
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)

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
        self_message: DummyMessage | None = None,
        usage: LLMUsage | None = None,
        prompt_messages: list[DummyMessage] | None = None,
    ):
        self.message: DummyMessage | None = self_message
        self.usage: LLMUsage | None = usage
        self.prompt_messages: list[DummyMessage] = prompt_messages or []
        self.system_fingerprint: str = ""

# ==============================
# Fixtures
# ==============================

@pytest.fixture
def runner(mocker):
    # 1. Patch BaseAgentRunner __init__ AND the new EROS hydrator
    mocker.patch(
        "core.agent.base_agent_runner.BaseAgentRunner.__init__",
        return_value=None,
    )
    
    # EROS FIX: Mock the hydrator so it doesn't try to hit a real cache/DB
    mock_hydrator = mocker.patch("core.agent.fc_agent_runner.get_hydrator")
    mock_hydrator.return_value.hydrate.return_value = MagicMock(
        status='MISS', 
        fingerprint='test_fp', 
        plan_steps=[]
    )

    # Patch streaming chunk models to avoid validation on dummy message objects
    mocker.patch("core.agent.fc_agent_runner.LLMResultChunk", MagicMock)
    mocker.patch("core.agent.fc_agent_runner.LLMResultChunkDelta", MagicMock)

    app_config = MagicMock()
    app_config.agent = MagicMock(max_iteration=2, tools=[]) 
    app_config.prompt_template = MagicMock(simple_prompt_template="system")

    application_generate_entity = MagicMock()
    application_generate_entity.model_conf = MagicMock(parameters={}, stop=None)
    application_generate_entity.trace_manager = MagicMock()
    application_generate_entity.invoke_from = "test"
    application_generate_entity.query = "test query"
    application_generate_entity.app_config = MagicMock(app_id="app")
    application_generate_entity.file_upload_config = None

    queue_manager = MagicMock()
    model_instance = MagicMock()
    model_instance.model = "test-model"
    model_instance.model_name = "test-model"

    message = MagicMock(id="msg1")
    conversation = MagicMock(id="conv1")

    # Initialize the runner
    runner_instance = FunctionCallAgentRunner(
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

    # 2. Manually inject EROS-specific attributes needed for Layer 3 tracking
    runner_instance.iteration_steps = [] 
    runner_instance.use_cached_plan = False
    runner_instance.plan_fingerprint = "test_fp"
    runner_instance.is_partial_match = False

    # Standard Dify attributes
    runner_instance.tenant_id = "tenant"
    runner_instance.application_generate_entity = application_generate_entity
    runner_instance.conversation = conversation
    runner_instance.app_config = app_config
    runner_instance.model_config = MagicMock()
    runner_instance.config = MagicMock()
    runner_instance.queue_manager = queue_manager
    runner_instance.message = message
    runner_instance.user_id = "user"
    runner_instance.model_instance = model_instance

    runner_instance.stream_tool_call = False
    runner_instance.memory = None
    runner_instance.history_prompt_messages = []
    runner_instance._current_thoughts = []
    runner_instance.files = []
    runner_instance.agent_callback = MagicMock()

    runner_instance._init_prompt_tools = MagicMock(return_value=({}, []))
    runner_instance.create_agent_thought = MagicMock(return_value="thought1")
    runner_instance.save_agent_thought = MagicMock()
    runner_instance.recalc_llm_max_tokens = MagicMock()
    runner_instance.update_prompt_message_tool = MagicMock()

    return runner_instance

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
        result = DummyResult(self_message=DummyMessage(tool_calls=tool_calls))
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

        result = DummyResult(self_message=DummyMessage(tool_calls=[tool_call]))
        calls = runner.extract_blocking_tool_calls(result)

        assert calls == [("2", "block", {"x": 2})]

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

# ==============================
# Run Method Tests
# ==============================

class TestRunMethod:
    def test_run_non_streaming_no_tool_calls(self, runner):
        message = MagicMock(id="m1")
        dummy_message = DummyMessage(content="hello")
        result = DummyResult(self_message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        outputs = list(runner.run(message, "query"))
        assert len(outputs) == 1
        runner.queue_manager.publish.assert_called()

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

    def test_run_max_iteration_error(self, runner):
        runner.app_config.agent.max_iteration = 0

        message = MagicMock(id="m1")
        tool_call = MagicMock()
        tool_call.id = "1"
        tool_call.function.name = "tool"
        tool_call.function.arguments = "{}"

        dummy_message = DummyMessage(content="", tool_calls=[tool_call])
        result = DummyResult(self_message=dummy_message, usage=build_usage())

        runner.model_instance.invoke_llm.return_value = result

        with pytest.raises(AgentMaxIterationError):
            list(runner.run(message, "query"))

# ==============================
# EROS Iteration Tracking (The Missing Piece)
# ==============================

class TestEROSTracking:
    def test_save_thought_updates_iteration_steps(self, runner, mocker):
        """Ensures that every agent thought is recorded in the EROS iteration_steps."""
        # Un-mock save_agent_thought to test the real iterative logic
        runner.save_agent_thought = FunctionCallAgentRunner.save_agent_thought.__get__(runner)
        mocker.patch('core.agent.base_agent_runner.db.session.scalar', return_value=MagicMock())
        
        usage = build_usage()
        runner.save_agent_thought(
            agent_thought_id="t1",
            tool_name="weather",
            tool_input={"city": "London"},
            thought="checking",
            observation="rain",
            answer=None,
            tool_meta=None,
            files=[],
            message_usage=usage
        )
        
        # Verify Layer 3 captured the iteration
        assert len(runner.iteration_steps) == 1
        assert runner.iteration_steps[0]['tool'] == "weather"

