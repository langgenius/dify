import json

import pytest

from core.agent.cot_completion_agent_runner import CotCompletionAgentRunner
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)

# -----------------------------
# Dummy Helpers
# -----------------------------


class DummyTool:
    def __init__(self, name):
        self.name = name


class DummyPromptEntity:
    def __init__(self, first_prompt):
        self.first_prompt = first_prompt


class DummyAgentConfig:
    def __init__(self, prompt_entity=None):
        self.prompt = prompt_entity


class DummyAppConfig:
    def __init__(self, agent=None):
        self.agent = agent


class DummyScratchpadUnit:
    def __init__(
        self,
        final=False,
        thought=None,
        action_str=None,
        observation=None,
        agent_response=None,
    ):
        self._final = final
        self.thought = thought
        self.action_str = action_str
        self.observation = observation
        self.agent_response = agent_response

    def is_final(self):
        return self._final


# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def runner(mocker):
    runner = CotCompletionAgentRunner.__new__(CotCompletionAgentRunner)

    runner._instruction = "Test instruction"
    runner._prompt_messages_tools = [DummyTool("toolA"), DummyTool("toolB")]
    runner._query = "What is Python?"
    runner._agent_scratchpad = []

    mocker.patch(
        "core.agent.cot_completion_agent_runner.jsonable_encoder",
        side_effect=lambda tools: [{"name": t.name} for t in tools],
    )

    return runner


# ======================================================
# _organize_instruction_prompt Tests
# ======================================================


class TestOrganizeInstructionPrompt:
    def test_success_all_placeholders(self, runner):
        template = (
            "{{instruction}} | {{tools}} | {{tool_names}} | {{historic_messages}} | {{agent_scratchpad}} | {{query}}"
        )

        runner.app_config = DummyAppConfig(agent=DummyAgentConfig(prompt_entity=DummyPromptEntity(template)))

        result = runner._organize_instruction_prompt()

        assert "Test instruction" in result
        assert "toolA" in result
        assert "toolB" in result
        assert json.dumps([{"name": "toolA"}, {"name": "toolB"}]) in result

    def test_agent_none_raises(self, runner):
        runner.app_config = DummyAppConfig(agent=None)
        with pytest.raises(ValueError, match="Agent configuration is not set"):
            runner._organize_instruction_prompt()

    def test_prompt_entity_none_raises(self, runner):
        runner.app_config = DummyAppConfig(agent=DummyAgentConfig(prompt_entity=None))
        with pytest.raises(ValueError, match="prompt entity is not set"):
            runner._organize_instruction_prompt()


# ======================================================
# _organize_historic_prompt Tests
# ======================================================


class TestOrganizeHistoricPrompt:
    def test_with_user_and_assistant_string(self, runner, mocker):
        user_msg = UserPromptMessage(content="Hello")
        assistant_msg = AssistantPromptMessage(content="Hi there")

        mocker.patch.object(
            runner,
            "_organize_historic_prompt_messages",
            return_value=[user_msg, assistant_msg],
        )

        result = runner._organize_historic_prompt()

        assert "Question: Hello" in result
        assert "Hi there" in result

    def test_assistant_list_with_text_content(self, runner, mocker):
        text_content = TextPromptMessageContent(data="Partial answer")
        assistant_msg = AssistantPromptMessage(content=[text_content])

        mocker.patch.object(
            runner,
            "_organize_historic_prompt_messages",
            return_value=[assistant_msg],
        )

        result = runner._organize_historic_prompt()

        assert "Partial answer" in result

    def test_assistant_list_with_non_text_content_ignored(self, runner, mocker):
        non_text_content = ImagePromptMessageContent(format="url", mime_type="image/png")
        assistant_msg = AssistantPromptMessage(content=[non_text_content])

        mocker.patch.object(
            runner,
            "_organize_historic_prompt_messages",
            return_value=[assistant_msg],
        )

        result = runner._organize_historic_prompt()
        assert result == ""

    def test_empty_history(self, runner, mocker):
        mocker.patch.object(
            runner,
            "_organize_historic_prompt_messages",
            return_value=[],
        )

        result = runner._organize_historic_prompt()
        assert result == ""


# ======================================================
# _organize_prompt_messages Tests
# ======================================================


class TestOrganizePromptMessages:
    def test_full_flow_with_scratchpad(self, runner, mocker):
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = DummyAppConfig(agent=DummyAgentConfig(prompt_entity=DummyPromptEntity(template)))

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="History\n")

        runner._agent_scratchpad = [
            DummyScratchpadUnit(final=False, thought="Thinking", action_str="Act", observation="Obs"),
            DummyScratchpadUnit(final=True, agent_response="Done"),
        ]

        result = runner._organize_prompt_messages()

        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], UserPromptMessage)

        content = result[0].content

        assert "History" in content
        assert "Thought: Thinking" in content
        assert "Action: Act" in content
        assert "Observation: Obs" in content
        assert "Final Answer: Done" in content
        assert "Question: What is Python?" in content

    def test_no_scratchpad(self, runner, mocker):
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = DummyAppConfig(agent=DummyAgentConfig(prompt_entity=DummyPromptEntity(template)))

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="")

        runner._agent_scratchpad = None

        result = runner._organize_prompt_messages()

        assert "Question: What is Python?" in result[0].content

    @pytest.mark.parametrize(
        ("thought", "action", "observation"),
        [
            ("T", None, None),
            ("T", "A", None),
            ("T", None, "O"),
        ],
    )
    def test_partial_scratchpad_units(self, runner, mocker, thought, action, observation):
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = DummyAppConfig(agent=DummyAgentConfig(prompt_entity=DummyPromptEntity(template)))

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="")

        runner._agent_scratchpad = [
            DummyScratchpadUnit(
                final=False,
                thought=thought,
                action_str=action,
                observation=observation,
            )
        ]

        result = runner._organize_prompt_messages()
        content = result[0].content

        assert "Thought:" in content
        if action:
            assert "Action:" in content
        if observation:
            assert "Observation:" in content
