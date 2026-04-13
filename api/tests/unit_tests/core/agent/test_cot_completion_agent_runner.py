import json

import pytest
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)

from core.agent.cot_completion_agent_runner import CotCompletionAgentRunner

# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def runner(mocker, dummy_tool_factory):
    runner = CotCompletionAgentRunner.__new__(CotCompletionAgentRunner)

    runner._instruction = "Test instruction"
    runner._prompt_messages_tools = [dummy_tool_factory("toolA"), dummy_tool_factory("toolB")]
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
    def test_success_all_placeholders(
        self, runner, dummy_app_config_factory, dummy_agent_config_factory, dummy_prompt_entity_factory
    ):
        template = (
            "{{instruction}} | {{tools}} | {{tool_names}} | {{historic_messages}} | {{agent_scratchpad}} | {{query}}"
        )

        runner.app_config = dummy_app_config_factory(
            agent=dummy_agent_config_factory(prompt_entity=dummy_prompt_entity_factory(template))
        )

        result = runner._organize_instruction_prompt()

        assert "Test instruction" in result
        assert "toolA" in result
        assert "toolB" in result
        tools_payload = json.loads(result.split(" | ")[1])
        assert {item["name"] for item in tools_payload} == {"toolA", "toolB"}

    def test_agent_none_raises(self, runner, dummy_app_config_factory):
        runner.app_config = dummy_app_config_factory(agent=None)
        with pytest.raises(ValueError, match="Agent configuration is not set"):
            runner._organize_instruction_prompt()

    def test_prompt_entity_none_raises(self, runner, dummy_app_config_factory, dummy_agent_config_factory):
        runner.app_config = dummy_app_config_factory(agent=dummy_agent_config_factory(prompt_entity=None))
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
    def test_full_flow_with_scratchpad(
        self,
        runner,
        mocker,
        dummy_app_config_factory,
        dummy_agent_config_factory,
        dummy_prompt_entity_factory,
        dummy_scratchpad_unit_factory,
    ):
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = dummy_app_config_factory(
            agent=dummy_agent_config_factory(prompt_entity=dummy_prompt_entity_factory(template))
        )

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="History\n")

        runner._agent_scratchpad = [
            dummy_scratchpad_unit_factory(final=False, thought="Thinking", action_str="Act", observation="Obs"),
            dummy_scratchpad_unit_factory(final=True, agent_response="Done"),
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

    def test_no_scratchpad(
        self, runner, mocker, dummy_app_config_factory, dummy_agent_config_factory, dummy_prompt_entity_factory
    ):
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = dummy_app_config_factory(
            agent=dummy_agent_config_factory(prompt_entity=dummy_prompt_entity_factory(template))
        )

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
    def test_partial_scratchpad_units(
        self,
        runner,
        mocker,
        thought,
        action,
        observation,
        dummy_app_config_factory,
        dummy_agent_config_factory,
        dummy_prompt_entity_factory,
        dummy_scratchpad_unit_factory,
    ):
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = dummy_app_config_factory(
            agent=dummy_agent_config_factory(prompt_entity=dummy_prompt_entity_factory(template))
        )

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="")

        runner._agent_scratchpad = [
            dummy_scratchpad_unit_factory(
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
