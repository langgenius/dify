from collections.abc import Sequence
from unittest.mock import MagicMock, Mock, patch

import pytest
from pytest_mock import MockerFixture

from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.entities import AgentEntity, AgentPromptEntity, AgentScratchpadUnit
from core.app.app_config.entities import (
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, InvokeFrom
from graphon.file import File, FileTransferMethod, FileType, FileUploadConfig, ImageConfig
from graphon.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageTool,
    TextPromptMessageContent,
)
from models.model import AppMode
from tests.helpers.unit.core.model_fixtures import make_model_config


def _agent(*, prompt: AgentPromptEntity | None) -> AgentEntity:
    return AgentEntity(
        provider="provider",
        model="model",
        strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
        prompt=prompt,
    )


def _app_config(*, agent: AgentEntity | None = None) -> AgentChatAppConfig:
    return AgentChatAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=AppMode.AGENT_CHAT,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="provider", model="model"),
        prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
        agent=agent,
    )


def _generate_entity(*, file_upload_config: FileUploadConfig | None = None) -> AgentChatAppGenerateEntity:
    return AgentChatAppGenerateEntity(
        task_id="task-id",
        model_conf=make_model_config(provider="provider", model="model", mode="chat"),
        app_config=_app_config(),
        inputs={},
        files=[],
        user_id="user-id",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
        file_upload_config=file_upload_config,
    )


def _image_file() -> File:
    return File(type=FileType.IMAGE, transfer_method=FileTransferMethod.LOCAL_FILE, reference="file1")


def _tool(*, name: str) -> PromptMessageTool:
    return PromptMessageTool(name=name, description=name, parameters={})


class DummyRunner(CotChatAgentRunner):
    """Test double that avoids BaseAgentRunner's heavy DB/model constructor."""

    def __init__(self) -> None:
        # Use a plain __init__ (init fn) rather than bypassing via __new__,
        # so the instance is fully initialised by the constructor.
        self._instruction = "test_instruction"
        self._prompt_messages_tools: Sequence[PromptMessageTool] = [_tool(name="tool1"), _tool(name="tool2")]
        self._query = "user query"
        self._agent_scratchpad: list[AgentScratchpadUnit] = []
        self.files: Sequence[File] = []
        self.application_generate_entity = _generate_entity()
        self._organize_historic_prompt_messages = MagicMock(return_value=["historic"])


@pytest.fixture
def runner() -> DummyRunner:
    return DummyRunner()


class TestOrganizeSystemPrompt:
    def test_organize_system_prompt_success(self, runner: DummyRunner, mocker: MockerFixture) -> None:
        first_prompt = "Instruction: {{instruction}}, Tools: {{tools}}, Names: {{tool_names}}"
        runner.app_config = _app_config(
            agent=_agent(prompt=AgentPromptEntity(first_prompt=first_prompt, next_iteration="next")),
        )

        mocker.patch(
            "core.agent.cot_chat_agent_runner.jsonable_encoder",
            return_value=[{"name": "tool1"}, {"name": "tool2"}],
        )

        result = runner._organize_system_prompt()

        assert isinstance(result.content, str)
        assert "test_instruction" in result.content
        assert "tool1" in result.content
        assert "tool2" in result.content
        assert "tool1, tool2" in result.content

    def test_organize_system_prompt_missing_agent(self, runner: DummyRunner) -> None:
        runner.app_config = _app_config(agent=None)
        with pytest.raises(AssertionError):
            runner._organize_system_prompt()

    def test_organize_system_prompt_missing_prompt(self, runner: DummyRunner) -> None:
        runner.app_config = _app_config(agent=_agent(prompt=None))
        with pytest.raises(AssertionError):
            runner._organize_system_prompt()


class TestOrganizeUserQuery:
    @pytest.mark.parametrize("files", [None, pytest.param([], id="empty_list")])
    def test_organize_user_query_no_files(self, runner: DummyRunner, files: list[File] | None) -> None:
        runner.files = files or []
        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert result[0].content == "query"

    @patch("core.agent.cot_chat_agent_runner.UserPromptMessage")
    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_image_file_default_config(
        self, mock_to_prompt: MagicMock, mock_user_prompt: MagicMock, runner: DummyRunner
    ) -> None:
        mock_content = ImagePromptMessageContent(
            url="http://test",
            format="png",
            mime_type="image/png",
        )
        mock_to_prompt.return_value = mock_content
        mock_user_prompt.side_effect = lambda content: MagicMock(content=content)

        image_file = _image_file()
        runner.files = [image_file]
        runner.application_generate_entity = _generate_entity(file_upload_config=None)

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)
        assert mock_content in result[0].content
        mock_to_prompt.assert_called_once_with(
            image_file,
            image_detail_config=ImagePromptMessageContent.DETAIL.LOW,
        )

    @patch("core.agent.cot_chat_agent_runner.UserPromptMessage")
    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_image_file_high_detail(
        self, mock_to_prompt: MagicMock, mock_user_prompt: MagicMock, runner: DummyRunner
    ) -> None:
        mock_content = ImagePromptMessageContent(
            url="http://test",
            format="png",
            mime_type="image/png",
        )
        mock_to_prompt.return_value = mock_content
        mock_user_prompt.side_effect = lambda content: MagicMock(content=content)

        image_file = _image_file()
        runner.files = [image_file]

        image_config = ImageConfig(detail=ImagePromptMessageContent.DETAIL.HIGH)
        runner.application_generate_entity = _generate_entity(
            file_upload_config=FileUploadConfig(image_config=image_config),
        )

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)
        assert mock_content in result[0].content
        mock_to_prompt.assert_called_once_with(
            image_file,
            image_detail_config=ImagePromptMessageContent.DETAIL.HIGH,
        )

    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_text_file_no_config(self, mock_to_prompt: MagicMock, runner: DummyRunner) -> None:
        mock_to_prompt.return_value = TextPromptMessageContent(data="file_content")
        runner.files = [File(type=FileType.DOCUMENT, transfer_method=FileTransferMethod.LOCAL_FILE, reference="file1")]
        runner.application_generate_entity = _generate_entity(file_upload_config=None)

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)


class TestOrganizePromptMessages:
    def _prepare(self, runner: DummyRunner, mocker: MockerFixture) -> None:
        runner.app_config = _app_config(
            agent=_agent(prompt=AgentPromptEntity(first_prompt="{{instruction}}", next_iteration="next")),
        )
        mocker.patch.object(runner, "_organize_system_prompt", return_value="system")
        mocker.patch.object(runner, "_organize_user_query", return_value=["query"])

    def test_no_scratchpad(self, runner: DummyRunner, mocker: MockerFixture) -> None:
        self._prepare(runner, mocker)

        result = runner._organize_prompt_messages()
        assert "system" in result
        assert "query" in result
        historic_mock = runner._organize_historic_prompt_messages
        assert isinstance(historic_mock, Mock)
        historic_mock.assert_called_once()

    def test_with_final_scratchpad(self, runner: DummyRunner, mocker: MockerFixture) -> None:
        self._prepare(runner, mocker)

        runner._agent_scratchpad = [AgentScratchpadUnit(agent_response="done")]

        result = runner._organize_prompt_messages()
        combined = "".join([m.content for m in result if isinstance(m, PromptMessage) and isinstance(m.content, str)])
        assert "Final Answer: done" in combined

    def test_with_thought_action_observation(self, runner: DummyRunner, mocker: MockerFixture) -> None:
        self._prepare(runner, mocker)

        runner._agent_scratchpad = [
            AgentScratchpadUnit(
                thought="thinking",
                action_str="action",
                observation="observe",
                action=AgentScratchpadUnit.Action(action_name="tool", action_input={}),
            )
        ]

        result = runner._organize_prompt_messages()
        combined = "".join([m.content for m in result if isinstance(m, PromptMessage) and isinstance(m.content, str)])
        assert "Thought: thinking" in combined
        assert "Action: action" in combined
        assert "Observation: observe" in combined

    def test_multiple_units_mixed(self, runner: DummyRunner, mocker: MockerFixture) -> None:
        self._prepare(runner, mocker)

        runner._agent_scratchpad = [
            AgentScratchpadUnit(
                thought="t1",
                action=AgentScratchpadUnit.Action(action_name="tool", action_input={}),
            ),
            AgentScratchpadUnit(agent_response="done"),
        ]

        result = runner._organize_prompt_messages()
        combined = "".join([m.content for m in result if isinstance(m, PromptMessage) and isinstance(m.content, str)])
        assert "Thought: t1" in combined
        assert "Final Answer: done" in combined
