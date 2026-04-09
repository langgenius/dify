import json
from unittest.mock import MagicMock

import pytest
from graphon.model_runtime.entities.llm_entities import LLMUsage

from core.agent.cot_agent_runner import CotAgentRunner
from core.agent.entities import AgentScratchpadUnit
from core.agent.errors import AgentMaxIterationError


class DummyRunner(CotAgentRunner):
    """Concrete implementation for testing abstract methods."""

    def __init__(self, **kwargs):
        # Completely bypass BaseAgentRunner __init__ to avoid DB/session usage
        for k, v in kwargs.items():
            setattr(self, k, v)
        # Minimal required defaults
        self.history_prompt_messages = []
        self.memory = None

    def _organize_prompt_messages(self):
        return []


@pytest.fixture
def runner(mocker):
    # Prevent BaseAgentRunner __init__ from hitting database
    mocker.patch(
        "core.agent.base_agent_runner.BaseAgentRunner.organize_agent_history",
        return_value=[],
    )
    # Prepare required constructor dependencies for BaseAgentRunner
    application_generate_entity = MagicMock()
    application_generate_entity.model_conf = MagicMock()
    application_generate_entity.model_conf.stop = []
    application_generate_entity.model_conf.provider = "openai"
    application_generate_entity.model_conf.parameters = {}
    application_generate_entity.trace_manager = None
    application_generate_entity.invoke_from = "test"

    app_config = MagicMock()
    app_config.agent = MagicMock()
    app_config.agent.max_iteration = 1
    app_config.prompt_template.simple_prompt_template = "Hello {{name}}"

    model_instance = MagicMock()
    model_instance.model = "test-model"
    model_instance.model_name = "test-model"
    model_instance.invoke_llm.return_value = []

    model_config = MagicMock()
    model_config.model = "test-model"

    queue_manager = MagicMock()
    message = MagicMock()

    runner = DummyRunner(
        tenant_id="tenant",
        application_generate_entity=application_generate_entity,
        conversation=MagicMock(),
        app_config=app_config,
        model_config=model_config,
        config=MagicMock(),
        queue_manager=queue_manager,
        message=message,
        user_id="user",
        model_instance=model_instance,
    )

    # Patch internal methods to isolate behavior
    runner._repack_app_generate_entity = MagicMock()
    runner._init_prompt_tools = MagicMock(return_value=({}, []))
    runner.recalc_llm_max_tokens = MagicMock()
    runner.create_agent_thought = MagicMock(return_value="thought-id")
    runner.save_agent_thought = MagicMock()
    runner.update_prompt_message_tool = MagicMock()
    runner.agent_callback = None
    runner.memory = None
    runner.history_prompt_messages = []

    return runner


class TestFillInputs:
    @pytest.mark.parametrize(
        ("instruction", "inputs", "expected"),
        [
            ("Hello {{name}}", {"name": "John"}, "Hello John"),
            ("No placeholders", {"name": "John"}, "No placeholders"),
            ("{{a}}{{b}}", {"a": 1, "b": 2}, "12"),
            ("{{x}}", {"x": None}, "None"),
            ("", {"x": "y"}, ""),
        ],
    )
    def test_fill_in_inputs(self, runner, instruction, inputs, expected):
        result = runner._fill_in_inputs_from_external_data_tools(instruction, inputs)
        assert result == expected


class TestConvertDictToAction:
    def test_convert_valid_dict(self, runner):
        action_dict = {"action": "test", "action_input": {"a": 1}}
        action = runner._convert_dict_to_action(action_dict)
        assert action.action_name == "test"
        assert action.action_input == {"a": 1}

    def test_convert_missing_keys(self, runner):
        with pytest.raises(KeyError):
            runner._convert_dict_to_action({"invalid": 1})


class TestFormatAssistantMessage:
    def test_format_assistant_message_multiple_scratchpads(self, runner):
        sp1 = AgentScratchpadUnit(
            agent_response="resp1",
            thought="thought1",
            action_str="action1",
            action=AgentScratchpadUnit.Action(action_name="tool", action_input={}),
            observation="obs1",
        )
        sp2 = AgentScratchpadUnit(
            agent_response="final",
            thought="",
            action_str="",
            action=AgentScratchpadUnit.Action(action_name="Final Answer", action_input="done"),
            observation=None,
        )
        result = runner._format_assistant_message([sp1, sp2])
        assert "Final Answer:" in result

    def test_format_with_final(self, runner):
        scratchpad = AgentScratchpadUnit(
            agent_response="Done",
            thought="",
            action_str="",
            action=None,
            observation=None,
        )
        # Simulate final state via action name
        scratchpad.action = AgentScratchpadUnit.Action(action_name="Final Answer", action_input="Done")
        result = runner._format_assistant_message([scratchpad])
        assert "Final Answer" in result

    def test_format_with_action_and_observation(self, runner):
        scratchpad = AgentScratchpadUnit(
            agent_response="resp",
            thought="thinking",
            action_str="action",
            action=None,
            observation="obs",
        )
        # Non-final state: provide a non-final action
        scratchpad.action = AgentScratchpadUnit.Action(action_name="tool", action_input={})
        result = runner._format_assistant_message([scratchpad])
        assert "Thought:" in result
        assert "Action:" in result
        assert "Observation:" in result


class TestHandleInvokeAction:
    def test_handle_invoke_action_tool_not_present(self, runner):
        action = AgentScratchpadUnit.Action(action_name="missing", action_input={})
        response, meta = runner._handle_invoke_action(action, {}, [])
        assert "there is not a tool named" in response

    def test_tool_with_json_string_args(self, runner, mocker):
        action = AgentScratchpadUnit.Action(action_name="tool", action_input=json.dumps({"a": 1}))
        tool_instance = MagicMock()
        tool_instances = {"tool": tool_instance}

        mocker.patch(
            "core.agent.cot_agent_runner.ToolEngine.agent_invoke",
            return_value=("result", [], MagicMock(to_dict=lambda: {})),
        )

        response, meta = runner._handle_invoke_action(action, tool_instances, [])
        assert response == "result"


class TestOrganizeHistoricPromptMessages:
    def test_empty_history(self, runner, mocker):
        mocker.patch(
            "core.agent.cot_agent_runner.AgentHistoryPromptTransform.get_prompt",
            return_value=[],
        )
        result = runner._organize_historic_prompt_messages([])
        assert result == []


class TestRun:
    def test_run_handles_empty_parser_output(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[],
        )

        results = list(runner.run(message, "query", {}))
        assert isinstance(results, list)

    def test_run_with_action_and_tool_invocation(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        action = AgentScratchpadUnit.Action(action_name="tool", action_input={})

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[action],
        )

        mocker.patch(
            "core.agent.cot_agent_runner.ToolEngine.agent_invoke",
            return_value=("ok", [], MagicMock(to_dict=lambda: {})),
        )

        runner.agent_callback = None

        with pytest.raises(AgentMaxIterationError):
            list(runner.run(message, "query", {"tool": MagicMock()}))

    def test_run_respects_max_iteration_boundary(self, runner, mocker):
        runner.app_config.agent.max_iteration = 1
        message = MagicMock()
        message.id = "msg-id"

        action = AgentScratchpadUnit.Action(action_name="tool", action_input={})

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[action],
        )

        mocker.patch(
            "core.agent.cot_agent_runner.ToolEngine.agent_invoke",
            return_value=("ok", [], MagicMock(to_dict=lambda: {})),
        )

        runner.agent_callback = None

        with pytest.raises(AgentMaxIterationError):
            list(runner.run(message, "query", {"tool": MagicMock()}))

    def test_run_basic_flow(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[],
        )

        results = list(runner.run(message, "query", {"name": "John"}))
        assert results

    def test_run_max_iteration_error(self, runner, mocker):
        runner.app_config.agent.max_iteration = 0
        message = MagicMock()
        message.id = "msg-id"

        action = AgentScratchpadUnit.Action(action_name="tool", action_input={})

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[action],
        )

        with pytest.raises(AgentMaxIterationError):
            list(runner.run(message, "query", {}))

    def test_run_increase_usage_aggregation(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"
        runner.app_config.agent.max_iteration = 2

        usage_1 = LLMUsage.empty_usage()
        usage_1.prompt_tokens = 1
        usage_1.completion_tokens = 1
        usage_1.total_tokens = 2
        usage_1.prompt_price = 1
        usage_1.completion_price = 1
        usage_1.total_price = 2

        usage_2 = LLMUsage.empty_usage()
        usage_2.prompt_tokens = 1
        usage_2.completion_tokens = 1
        usage_2.total_tokens = 2
        usage_2.prompt_price = 1
        usage_2.completion_price = 1
        usage_2.total_price = 2

        action = AgentScratchpadUnit.Action(action_name="tool", action_input={})

        handle_output = mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            side_effect=[
                [action],
                [],
            ],
        )

        def _handle_side_effect(chunks, usage_dict):
            call_index = handle_output.call_count
            usage_dict["usage"] = usage_1 if call_index == 1 else usage_2
            return [action] if call_index == 1 else []

        handle_output.side_effect = _handle_side_effect
        runner.model_instance.invoke_llm = MagicMock(return_value=[])
        mocker.patch(
            "core.agent.cot_agent_runner.ToolEngine.agent_invoke",
            return_value=("ok", [], MagicMock(to_dict=lambda: {})),
        )

        fake_prompt_tool = MagicMock()
        fake_prompt_tool.name = "tool"
        runner._init_prompt_tools = MagicMock(return_value=({"tool": MagicMock()}, [fake_prompt_tool]))

        results = list(runner.run(message, "query", {}))
        final_usage = results[-1].delta.usage
        assert final_usage is not None
        assert final_usage.prompt_tokens == 2
        assert final_usage.completion_tokens == 2
        assert final_usage.total_tokens == 4
        assert final_usage.prompt_price == 2
        assert final_usage.completion_price == 2
        assert final_usage.total_price == 4

    def test_run_when_no_action_branch(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[],
        )

        results = list(runner.run(message, "query", {}))
        assert results[-1].delta.message.content == ""

    def test_run_usage_missing_key_branch(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[],
        )

        runner.model_instance.invoke_llm = MagicMock(return_value=[])

        list(runner.run(message, "query", {}))

    def test_run_prompt_tool_update_branch(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        action = AgentScratchpadUnit.Action(action_name="tool", action_input={})

        # First iteration → action
        # Second iteration → no action (empty list)
        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            side_effect=[[action], []],
        )

        mocker.patch(
            "core.agent.cot_agent_runner.ToolEngine.agent_invoke",
            return_value=("ok", [], MagicMock(to_dict=lambda: {})),
        )

        runner.app_config.agent.max_iteration = 5

        fake_prompt_tool = MagicMock()
        fake_prompt_tool.name = "tool"

        runner._init_prompt_tools = MagicMock(return_value=({"tool": MagicMock()}, [fake_prompt_tool]))

        runner.update_prompt_message_tool = MagicMock()
        runner.agent_callback = None

        list(runner.run(message, "query", {}))

        runner.update_prompt_message_tool.assert_called_once()

    def test_historic_with_assistant_and_tool_calls(self, runner):
        from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, ToolPromptMessage

        assistant = AssistantPromptMessage(content="thinking")
        assistant.tool_calls = [MagicMock(function=MagicMock(name="tool", arguments='{"a":1}'))]

        tool_msg = ToolPromptMessage(content="obs", tool_call_id="1")

        runner.history_prompt_messages = [assistant, tool_msg]

        result = runner._organize_historic_prompt_messages([])
        assert isinstance(result, list)

    def test_historic_final_flush_branch(self, runner):
        from graphon.model_runtime.entities.message_entities import AssistantPromptMessage

        assistant = AssistantPromptMessage(content="final")
        runner.history_prompt_messages = [assistant]

        result = runner._organize_historic_prompt_messages([])
        assert isinstance(result, list)


class TestInitReactState:
    def test_init_react_state_resets_state(self, runner, mocker):
        mocker.patch.object(runner, "_organize_historic_prompt_messages", return_value=["historic"])
        runner._agent_scratchpad = ["old"]
        runner._query = "old"

        runner._init_react_state("new-query")

        assert runner._query == "new-query"
        assert runner._agent_scratchpad == []
        assert runner._historic_prompt_messages == ["historic"]


class TestHandleInvokeActionExtended:
    def test_tool_with_invalid_json_string_args(self, runner, mocker):
        action = AgentScratchpadUnit.Action(action_name="tool", action_input="not-json")
        tool_instance = MagicMock()
        tool_instances = {"tool": tool_instance}

        mocker.patch(
            "core.agent.cot_agent_runner.ToolEngine.agent_invoke",
            return_value=("ok", ["file1"], MagicMock(to_dict=lambda: {"k": "v"})),
        )

        message_file_ids = []
        response, meta = runner._handle_invoke_action(action, tool_instances, message_file_ids)

        assert response == "ok"
        assert message_file_ids == ["file1"]
        runner.queue_manager.publish.assert_called()


class TestFillInputsEdgeCases:
    def test_fill_inputs_with_empty_inputs(self, runner):
        result = runner._fill_in_inputs_from_external_data_tools("Hello {{x}}", {})
        assert result == "Hello {{x}}"

    def test_fill_inputs_with_exception_in_replace(self, runner):
        class BadValue:
            def __str__(self):
                raise Exception("fail")

        # Should silently continue on exception
        result = runner._fill_in_inputs_from_external_data_tools("Hello {{x}}", {"x": BadValue()})
        assert result == "Hello {{x}}"


class TestOrganizeHistoricPromptMessagesExtended:
    def test_user_message_flushes_scratchpad(self, runner, mocker):
        from graphon.model_runtime.entities.message_entities import UserPromptMessage

        user_message = UserPromptMessage(content="Hi")

        runner.history_prompt_messages = [user_message]

        mock_transform = mocker.patch(
            "core.agent.cot_agent_runner.AgentHistoryPromptTransform",
        )
        mock_transform.return_value.get_prompt.return_value = ["final"]

        result = runner._organize_historic_prompt_messages([])
        assert result == ["final"]

    def test_tool_message_without_scratchpad_raises(self, runner):
        from graphon.model_runtime.entities.message_entities import ToolPromptMessage

        runner.history_prompt_messages = [ToolPromptMessage(content="obs", tool_call_id="1")]

        with pytest.raises(NotImplementedError):
            runner._organize_historic_prompt_messages([])

    def test_agent_history_transform_invocation(self, runner, mocker):
        mock_transform = MagicMock()
        mock_transform.get_prompt.return_value = []

        mocker.patch(
            "core.agent.cot_agent_runner.AgentHistoryPromptTransform",
            return_value=mock_transform,
        )

        runner.history_prompt_messages = []
        result = runner._organize_historic_prompt_messages([])
        assert result == []


class TestRunAdditionalBranches:
    def test_run_with_no_action_final_answer_empty(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=["thinking"],
        )

        results = list(runner.run(message, "query", {}))
        assert any(hasattr(r, "delta") for r in results)

    def test_run_with_final_answer_action_string(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        action = AgentScratchpadUnit.Action(action_name="Final Answer", action_input="done")

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[action],
        )

        results = list(runner.run(message, "query", {}))
        assert results[-1].delta.message.content == "done"

    def test_run_with_final_answer_action_dict(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        action = AgentScratchpadUnit.Action(action_name="Final Answer", action_input={"a": 1})

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[action],
        )

        results = list(runner.run(message, "query", {}))
        assert json.loads(results[-1].delta.message.content) == {"a": 1}

    def test_run_with_string_final_answer(self, runner, mocker):
        message = MagicMock()
        message.id = "msg-id"

        # Remove invalid branch: Pydantic enforces str|dict for action_input
        action = AgentScratchpadUnit.Action(action_name="Final Answer", action_input="12345")

        mocker.patch(
            "core.agent.cot_agent_runner.CotAgentOutputParser.handle_react_stream_output",
            return_value=[action],
        )

        results = list(runner.run(message, "query", {}))
        assert results[-1].delta.message.content == "12345"
