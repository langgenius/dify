from collections.abc import Sequence
from unittest.mock import MagicMock, patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.entities import AgentEntity, AgentPromptEntity, AgentScratchpadUnit
from core.app.app_config.entities import (
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, InvokeFrom
from core.model_manager import ModelInstance
from graphon.file import File, FileTransferMethod, FileType, FileUploadConfig, ImageConfig
from graphon.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from models.model import AppMode, Conversation, Message
from services.workflow_run_agg import WorkflowRunAgg
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


@pytest.fixture
def runner(
    sqlite_session: Session,
    agent_records: tuple[Conversation, Message],
    agent_queue_manager: MessageBasedAppQueueManager,
    mocker: MockerFixture,
) -> CotChatAgentRunner:
    """Build the real runner over persisted conversation rows.

    ``run`` assigns the react state before organizing prompts; the test sets the
    same attributes up front so ``_organize_*`` can be exercised in isolation.
    """

    conversation, message = agent_records
    app_config = _app_config(
        agent=_agent(prompt=AgentPromptEntity(first_prompt="{{instruction}}", next_iteration="next")),
    )
    model_config = make_model_config(provider="provider", model="model", mode="chat")
    model_instance = ModelInstance(
        provider_model_bundle=model_config.provider_model_bundle,
        model=model_config.model,
        credentials=model_config.credentials,
    )
    mocker.patch.object(model_instance.model_type_instance, "get_model_schema", return_value=None)

    runner = CotChatAgentRunner(
        execution_driver=WorkflowRunAgg.run,
        session=sqlite_session,
        tenant_id="tenant-id",
        application_generate_entity=_generate_entity(),
        conversation=conversation,
        app_config=app_config,
        model_config=model_config,
        config=_agent(prompt=None),
        queue_manager=agent_queue_manager,
        message=message,
        user_id="user-id",
        model_instance=model_instance,
    )
    runner._instruction = "test_instruction"
    runner._prompt_messages_tools = [_tool(name="tool1"), _tool(name="tool2")]
    runner._init_react_state("user query")
    return runner


class TestOrganizeSystemPrompt:
    def test_organize_system_prompt_success(self, runner: CotChatAgentRunner) -> None:
        first_prompt = "Instruction: {{instruction}}, Tools: {{tools}}, Names: {{tool_names}}"
        runner.app_config = _app_config(
            agent=_agent(prompt=AgentPromptEntity(first_prompt=first_prompt, next_iteration="next")),
        )

        result = runner._organize_system_prompt()

        assert isinstance(result, SystemPromptMessage)
        assert isinstance(result.content, str)
        assert "test_instruction" in result.content
        assert "tool1" in result.content
        assert "tool2" in result.content
        assert "tool1, tool2" in result.content

    def test_organize_system_prompt_missing_agent(self, runner: CotChatAgentRunner) -> None:
        runner.app_config = _app_config(agent=None)
        with pytest.raises(AssertionError):
            runner._organize_system_prompt()

    def test_organize_system_prompt_missing_prompt(self, runner: CotChatAgentRunner) -> None:
        runner.app_config = _app_config(agent=_agent(prompt=None))
        with pytest.raises(AssertionError):
            runner._organize_system_prompt()


class TestOrganizeUserQuery:
    @pytest.mark.parametrize("files", [None, pytest.param([], id="empty_list")])
    def test_organize_user_query_no_files(self, runner: CotChatAgentRunner, files: list[File] | None) -> None:
        runner.files = files or []
        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert result[0].content == "query"

    @patch("core.agent.cot_chat_agent_runner.UserPromptMessage")
    @patch("core.agent.cot_chat_agent_runner.file_manager.to_prompt_message_content")
    def test_organize_user_query_with_image_file_default_config(
        self, mock_to_prompt: MagicMock, mock_user_prompt: MagicMock, runner: CotChatAgentRunner
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
        self, mock_to_prompt: MagicMock, mock_user_prompt: MagicMock, runner: CotChatAgentRunner
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
    def test_organize_user_query_with_text_file_no_config(
        self, mock_to_prompt: MagicMock, runner: CotChatAgentRunner
    ) -> None:
        mock_to_prompt.return_value = TextPromptMessageContent(data="file_content")
        runner.files = [File(type=FileType.DOCUMENT, transfer_method=FileTransferMethod.LOCAL_FILE, reference="file1")]
        runner.application_generate_entity = _generate_entity(file_upload_config=None)

        result = runner._organize_user_query("query", [])
        assert len(result) == 1
        assert isinstance(result[0].content, list)


class TestOrganizePromptMessages:
    def _prepare(self, runner: CotChatAgentRunner) -> None:
        runner.app_config = _app_config(
            agent=_agent(prompt=AgentPromptEntity(first_prompt="{{instruction}}", next_iteration="next")),
        )
        runner._instruction = "test_instruction"
        runner._init_react_state("user query")

    @staticmethod
    def _text_contents(messages: Sequence[PromptMessage]) -> list[str]:
        return [message.content for message in messages if isinstance(message.content, str)]

    def test_no_scratchpad(self, runner: CotChatAgentRunner) -> None:
        self._prepare(runner)

        result = runner._organize_prompt_messages()

        assert [type(message) for message in result] == [SystemPromptMessage, UserPromptMessage]
        assert self._text_contents(result) == ["test_instruction", "user query"]
        assert runner._historic_prompt_messages == []

    def test_with_final_scratchpad(self, runner: CotChatAgentRunner) -> None:
        self._prepare(runner)

        runner._agent_scratchpad = [AgentScratchpadUnit(agent_response="done")]

        result = runner._organize_prompt_messages()
        combined = "".join(self._text_contents(result))
        assert "Final Answer: done" in combined
        assert isinstance(result[-1], UserPromptMessage)
        assert result[-1].content == "continue"

    def test_with_thought_action_observation(self, runner: CotChatAgentRunner) -> None:
        self._prepare(runner)

        runner._agent_scratchpad = [
            AgentScratchpadUnit(
                thought="thinking",
                action_str="action",
                observation="observe",
                action=AgentScratchpadUnit.Action(action_name="tool", action_input={}),
            )
        ]

        result = runner._organize_prompt_messages()
        combined = "".join(self._text_contents(result))
        assert "Thought: thinking" in combined
        assert "Action: action" in combined
        assert "Observation: observe" in combined

    def test_multiple_units_mixed(self, runner: CotChatAgentRunner) -> None:
        self._prepare(runner)

        runner._agent_scratchpad = [
            AgentScratchpadUnit(
                thought="t1",
                action=AgentScratchpadUnit.Action(action_name="tool", action_input={}),
            ),
            AgentScratchpadUnit(agent_response="done"),
        ]

        result = runner._organize_prompt_messages()
        combined = "".join(self._text_contents(result))
        assert "Thought: t1" in combined
        assert "Final Answer: done" in combined
