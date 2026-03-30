from unittest.mock import MagicMock, patch

import pytest
from graphon.model_runtime.entities.message_entities import TextPromptMessageContent

from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from tests.unit_tests.core.agent.conftest import (
    DummyAgentConfig,
    DummyAppConfig,
    DummyTool,
)
from tests.unit_tests.core.agent.conftest import (
    DummyPromptEntity as DummyPrompt,
)


class DummyFileUploadConfig:
    def __init__(self, image_config=None):
        self.image_config = image_config


class DummyImageConfig:
    def __init__(self, detail=None):
        self.detail = detail


class DummyGenerateEntity:
    def __init__(self, file_upload_config=None):
        self.file_upload_config = file_upload_config


class DummyUnit:
    def __init__(self, final=False, thought=None, action_str=None, observation=None, agent_response=None):
        self._final = final
        self.thought = thought
        self.action_str = action_str
        self.observation = observation
        self.agent_response = agent_response

    def is_final(self):
        return self._final


@pytest.fixture
def runner():
    runner = CotChatAgentRunner.__new__(CotChatAgentRunner)
    runner._instruction = "test_instruction"
    runner._prompt_messages_tools = [DummyTool("tool1"), DummyTool("tool2")]
    runner._query = "user query"
    runner._agent_scratchpad = []
    runner.files = []
    runner.application_generate_entity = DummyGenerateEntity()
    runner._organize_historic_prompt_messages = MagicMock(return_value=["historic"])
    return runner


class TestOrganizeSystemPrompt:
    def test_organize_system_prompt_success(self, runner, mocker):
        first_prompt = "Instruction: {{instruction}}, Tools: {{tools}}, Names: {{tool_names}}"
        runner.app_config = DummyAppConfig(DummyAgentConfig(DummyPrompt(first_prompt)))

        mocker.patch(
            "core.agent.cot_chat_agent_runner.jsonable_encoder",
            return_value=[{"name": "tool1"}, {"name": "tool2"}],
        )

        result = runner._organize_system_prompt()

        assert "test_instruction" in result.content
        assert "tool1" in result.content
        assert "tool2" in result.content
        assert "tool1, tool2" in result.content

    def test_organize_system_prompt_missing_agent(self, runner):
        runner.app_config = DummyAppConfig(agent=None)
        with pytest.raises(AssertionError):
            runner._organize_system_prompt()

    def test_organize_system_prompt_missing_prompt(self, runner):
        runner.app_config = DummyAppConfig(DummyAgentConfig(prompt_entity=None))
        with pytest.raises(AssertionError):
            runner._organize_system_prompt()


class TestOrganizeUserQuery:
    @pytest.mark.parametrize("files", [None, pytest.param([], id="empty_list")])
    def test_organize_user_query_no_files(self, runner, files):
        runner.files = files
        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert result[0].content == "query"

    @patch("core.agent.cot_chat_agent_runner.UserPromptMessage")
    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_image_file_default_config(self, mock_to_prompt, mock_user_prompt, runner):
        from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent

        mock_content = ImagePromptMessageContent(
            url="http://test",
            format="png",
            mime_type="image/png",
        )
        mock_to_prompt.return_value = mock_content
        mock_user_prompt.side_effect = lambda content: MagicMock(content=content)

        runner.files = ["file1"]
        runner.application_generate_entity = DummyGenerateEntity(None)

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)
        assert mock_content in result[0].content
        mock_to_prompt.assert_called_once_with(
            "file1",
            image_detail_config=ImagePromptMessageContent.DETAIL.LOW,
        )

    @patch("core.agent.cot_chat_agent_runner.UserPromptMessage")
    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_image_file_high_detail(self, mock_to_prompt, mock_user_prompt, runner):
        from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent

        mock_content = ImagePromptMessageContent(
            url="http://test",
            format="png",
            mime_type="image/png",
        )
        mock_to_prompt.return_value = mock_content
        mock_user_prompt.side_effect = lambda content: MagicMock(content=content)

        runner.files = ["file1"]

        image_config = DummyImageConfig(detail="high")
        runner.application_generate_entity = DummyGenerateEntity(DummyFileUploadConfig(image_config))

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)
        assert mock_content in result[0].content
        mock_to_prompt.assert_called_once_with(
            "file1",
            image_detail_config=ImagePromptMessageContent.DETAIL.HIGH,
        )

    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_text_file_no_config(self, mock_to_prompt, runner):
        mock_to_prompt.return_value = TextPromptMessageContent(data="file_content")
        runner.files = ["file1"]
        runner.application_generate_entity = DummyGenerateEntity(None)

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)


class TestOrganizePromptMessages:
    def test_no_scratchpad(self, runner, mocker):
        runner.app_config = DummyAppConfig(DummyAgentConfig(DummyPrompt("{{instruction}}")))
        runner._organize_system_prompt = MagicMock(return_value="system")
        runner._organize_user_query = MagicMock(return_value=["query"])

        result = runner._organize_prompt_messages()
        assert "system" in result
        assert "query" in result
        runner._organize_historic_prompt_messages.assert_called_once()

    def test_with_final_scratchpad(self, runner, mocker):
        runner.app_config = DummyAppConfig(DummyAgentConfig(DummyPrompt("{{instruction}}")))
        runner._organize_system_prompt = MagicMock(return_value="system")
        runner._organize_user_query = MagicMock(return_value=["query"])

        unit = DummyUnit(final=True, agent_response="done")
        runner._agent_scratchpad = [unit]

        result = runner._organize_prompt_messages()
        assistant_msgs = [m for m in result if hasattr(m, "content")]
        combined = "".join([m.content for m in assistant_msgs if isinstance(m.content, str)])
        assert "Final Answer: done" in combined

    def test_with_thought_action_observation(self, runner, mocker):
        runner.app_config = DummyAppConfig(DummyAgentConfig(DummyPrompt("{{instruction}}")))
        runner._organize_system_prompt = MagicMock(return_value="system")
        runner._organize_user_query = MagicMock(return_value=["query"])

        unit = DummyUnit(
            final=False,
            thought="thinking",
            action_str="action",
            observation="observe",
        )
        runner._agent_scratchpad = [unit]

        result = runner._organize_prompt_messages()
        assistant_msgs = [m for m in result if hasattr(m, "content")]
        combined = "".join([m.content for m in assistant_msgs if isinstance(m.content, str)])
        assert "Thought: thinking" in combined
        assert "Action: action" in combined
        assert "Observation: observe" in combined

    def test_multiple_units_mixed(self, runner, mocker):
        runner.app_config = DummyAppConfig(DummyAgentConfig(DummyPrompt("{{instruction}}")))
        runner._organize_system_prompt = MagicMock(return_value="system")
        runner._organize_user_query = MagicMock(return_value=["query"])

        units = [
            DummyUnit(final=False, thought="t1"),
            DummyUnit(final=True, agent_response="done"),
        ]
        runner._agent_scratchpad = units

        result = runner._organize_prompt_messages()
        assistant_msgs = [m for m in result if hasattr(m, "content")]
        combined = "".join([m.content for m in assistant_msgs if isinstance(m.content, str)])
        assert "Thought: t1" in combined
        assert "Final Answer: done" in combined
