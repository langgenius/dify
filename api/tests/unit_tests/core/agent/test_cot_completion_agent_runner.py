import json

import pytest
from pytest_mock import MockerFixture

from core.agent.cot_completion_agent_runner import CotCompletionAgentRunner
from core.agent.entities import AgentEntity, AgentPromptEntity, AgentScratchpadUnit
from core.app.app_config.entities import (
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageTool,
    TextPromptMessageContent,
    UserPromptMessage,
)
from models.model import AppMode

# -----------------------------
# Helpers
# -----------------------------


def _app_config(*, agent: AgentEntity | None = None) -> AgentChatAppConfig:
    return AgentChatAppConfig(
        tenant_id="tenant",
        app_id="app",
        app_mode=AppMode.AGENT_CHAT,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="provider", model="model"),
        prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
        agent=agent,
    )


def _agent(first_prompt: str | None) -> AgentEntity:
    prompt = None if first_prompt is None else AgentPromptEntity(first_prompt=first_prompt, next_iteration="")
    return AgentEntity(
        provider="provider",
        model="model",
        strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
        prompt=prompt,
    )


def _tool(name: str) -> PromptMessageTool:
    return PromptMessageTool(name=name, description="", parameters={"properties": {}, "required": []})


def _working_unit(*, thought: str | None, action_str: str | None, observation: str | None) -> AgentScratchpadUnit:
    # A non-empty action name keeps `is_final()` false for a mid-run scratchpad unit.
    return AgentScratchpadUnit(
        thought=thought,
        action_str=action_str,
        observation=observation,
        action=AgentScratchpadUnit.Action(action_name="search", action_input={}),
    )


# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def runner(mocker: MockerFixture) -> CotCompletionAgentRunner:
    runner = CotCompletionAgentRunner.__new__(CotCompletionAgentRunner)

    runner._instruction = "Test instruction"
    runner._prompt_messages_tools = [_tool("toolA"), _tool("toolB")]
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
    def test_success_all_placeholders(self, runner: CotCompletionAgentRunner) -> None:
        template = (
            "{{instruction}} | {{tools}} | {{tool_names}} | {{historic_messages}} | {{agent_scratchpad}} | {{query}}"
        )

        runner.app_config = _app_config(agent=_agent(template))

        result = runner._organize_instruction_prompt()

        assert "Test instruction" in result
        assert "toolA" in result
        assert "toolB" in result
        tools_payload = json.loads(result.split(" | ")[1])
        assert {item["name"] for item in tools_payload} == {"toolA", "toolB"}

    def test_agent_none_raises(self, runner: CotCompletionAgentRunner) -> None:
        runner.app_config = _app_config(agent=None)
        with pytest.raises(ValueError, match="Agent configuration is not set"):
            runner._organize_instruction_prompt()

    def test_prompt_entity_none_raises(self, runner: CotCompletionAgentRunner) -> None:
        runner.app_config = _app_config(agent=_agent(None))
        with pytest.raises(ValueError, match="prompt entity is not set"):
            runner._organize_instruction_prompt()


# ======================================================
# _organize_historic_prompt Tests
# ======================================================


class TestOrganizeHistoricPrompt:
    def test_with_user_and_assistant_string(self, runner: CotCompletionAgentRunner, mocker: MockerFixture) -> None:
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

    def test_assistant_list_with_text_content(self, runner: CotCompletionAgentRunner, mocker: MockerFixture) -> None:
        text_content = TextPromptMessageContent(data="Partial answer")
        assistant_msg = AssistantPromptMessage(content=[text_content])

        mocker.patch.object(
            runner,
            "_organize_historic_prompt_messages",
            return_value=[assistant_msg],
        )

        result = runner._organize_historic_prompt()

        assert "Partial answer" in result

    def test_assistant_list_with_non_text_content_ignored(
        self, runner: CotCompletionAgentRunner, mocker: MockerFixture
    ) -> None:
        non_text_content = ImagePromptMessageContent(format="url", mime_type="image/png")
        assistant_msg = AssistantPromptMessage(content=[non_text_content])

        mocker.patch.object(
            runner,
            "_organize_historic_prompt_messages",
            return_value=[assistant_msg],
        )

        result = runner._organize_historic_prompt()
        assert result == ""

    def test_empty_history(self, runner: CotCompletionAgentRunner, mocker: MockerFixture) -> None:
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
        runner: CotCompletionAgentRunner,
        mocker: MockerFixture,
    ) -> None:
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = _app_config(agent=_agent(template))

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="History\n")

        runner._agent_scratchpad = [
            _working_unit(thought="Thinking", action_str="Act", observation="Obs"),
            AgentScratchpadUnit(agent_response="Done"),
        ]

        result = runner._organize_prompt_messages()

        assert len(result) == 1
        assert isinstance(result[0], UserPromptMessage)

        content = result[0].content
        assert isinstance(content, str)

        assert "History" in content
        assert "Thought: Thinking" in content
        assert "Action: Act" in content
        assert "Observation: Obs" in content
        assert "Final Answer: Done" in content
        assert "Question: What is Python?" in content

    def test_no_scratchpad(
        self,
        runner: CotCompletionAgentRunner,
        mocker: MockerFixture,
    ) -> None:
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = _app_config(agent=_agent(template))

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="")

        runner._agent_scratchpad = []

        result = runner._organize_prompt_messages()

        content = result[0].content
        assert isinstance(content, str)
        assert "Question: What is Python?" in content

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
        runner: CotCompletionAgentRunner,
        mocker: MockerFixture,
        thought: str,
        action: str | None,
        observation: str | None,
    ) -> None:
        template = "SYS {{historic_messages}} {{agent_scratchpad}} {{query}}"

        runner.app_config = _app_config(agent=_agent(template))

        mocker.patch.object(runner, "_organize_historic_prompt", return_value="")

        runner._agent_scratchpad = [
            _working_unit(thought=thought, action_str=action, observation=observation),
        ]

        result = runner._organize_prompt_messages()
        content = result[0].content
        assert isinstance(content, str)

        assert "Thought:" in content
        if action:
            assert "Action:" in content
        if observation:
            assert "Observation:" in content
