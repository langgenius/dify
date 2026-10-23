from __future__ import annotations

import logging
from dataclasses import dataclass
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    AdvancedChatMessageEntity,
    AdvancedChatPromptTemplateEntity,
    AdvancedCompletionPromptTemplateEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_runner import AppRunner
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AppGenerateEntity,
    EasyUIBasedAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.app.entities.queue_entities import (
    QueueAgentMessageEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueMessageFileEvent,
)
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
)
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from models.enums import CreatorUserRole
from models.model import App, AppMode, Message, MessageFile
from models.tools import ToolFile

"""Test multimodal image output handling in BaseAppRunner."""


class TestBaseAppRunnerMultimodal:
    """Test that BaseAppRunner correctly handles multimodal image content."""

    @pytest.fixture
    def mock_user_id(self):
        """Mock user ID."""
        return str(uuid4())

    @pytest.fixture
    def mock_tenant_id(self):
        """Mock tenant ID."""
        return str(uuid4())

    @pytest.fixture
    def mock_message_id(self):
        """Mock message ID."""
        return str(uuid4())

    @pytest.fixture
    def mock_queue_manager(self):
        """Create a mock queue manager."""
        manager = MagicMock()
        manager.invoke_from = InvokeFrom.SERVICE_API
        return manager

    @pytest.fixture
    def tool_file(self, mock_user_id: str, mock_tenant_id: str) -> ToolFile:
        """Create a real transient tool-file model returned by the external file manager."""
        return ToolFile(
            user_id=mock_user_id,
            tenant_id=mock_tenant_id,
            conversation_id=None,
            file_key="generated/image.png",
            mimetype="image/png",
            original_url="http://example.com/image.png",
            name="image.png",
            size=68,
        )

    def test_handle_multimodal_image_content_with_url(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        tool_file,
        sqlite_session: Session,
    ):
        """Test handling image from URL."""
        # Arrange
        image_url = "http://example.com/image.png"
        content = ImagePromptMessageContent(
            url=image_url,
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.return_value = tool_file
            mock_mgr_class.return_value = mock_mgr

            message_file_id = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        mock_mgr.create_file_by_url.assert_called_once_with(
            user_id=mock_user_id,
            tenant_id=mock_tenant_id,
            file_url=image_url,
            conversation_id=None,
        )
        message_file = sqlite_session.get(MessageFile, message_file_id)
        assert message_file is not None
        assert message_file.message_id == mock_message_id
        assert message_file.type == FileType.IMAGE
        assert message_file.transfer_method == FileTransferMethod.TOOL_FILE
        assert message_file.belongs_to == "assistant"
        assert message_file.created_by == mock_user_id
        assert message_file.upload_file_id == tool_file.id
        mock_queue_manager.publish.assert_not_called()

    def test_handle_multimodal_image_content_with_base64(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        tool_file,
        sqlite_session: Session,
    ):
        """Test handling image from base64 data."""
        # Arrange
        import base64

        # Create a small test image (1x1 PNG)
        test_image_data = base64.b64encode(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        ).decode()
        content = ImagePromptMessageContent(
            base64_data=test_image_data,
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_raw.return_value = tool_file
            mock_mgr_class.return_value = mock_mgr

            message_file_id = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        mock_mgr.create_file_by_raw.assert_called_once()
        call_kwargs = mock_mgr.create_file_by_raw.call_args[1]
        assert call_kwargs["user_id"] == mock_user_id
        assert call_kwargs["tenant_id"] == mock_tenant_id
        assert call_kwargs["conversation_id"] is None
        assert "file_binary" in call_kwargs
        assert call_kwargs["mimetype"] == "image/png"
        assert call_kwargs["filename"].startswith("generated_image")
        assert call_kwargs["filename"].endswith(".png")
        assert sqlite_session.get(MessageFile, message_file_id) is not None
        mock_queue_manager.publish.assert_not_called()

    def test_handle_multimodal_image_content_with_base64_data_uri(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        tool_file,
        sqlite_session: Session,
    ):
        """Test handling image from base64 data with URI prefix."""
        # Arrange
        # Data URI format: data:image/png;base64,<base64_data>
        test_image_data = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        content = ImagePromptMessageContent(
            base64_data=f"data:image/png;base64,{test_image_data}",
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_raw.return_value = tool_file
            mock_mgr_class.return_value = mock_mgr

            message_file_id = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        mock_mgr.create_file_by_raw.assert_called_once()
        call_kwargs = mock_mgr.create_file_by_raw.call_args[1]
        assert "file_binary" in call_kwargs
        assert sqlite_session.get(MessageFile, message_file_id) is not None

    def test_handle_multimodal_image_content_without_url_or_base64(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        sqlite_session: Session,
    ):
        """Test handling image content without URL or base64 data."""
        # Arrange
        content = ImagePromptMessageContent(
            url="",
            base64_data="",
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            result = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        assert result is None
        assert sqlite_session.scalar(select(func.count()).select_from(MessageFile)) == 0
        mock_mgr_class.assert_not_called()
        mock_queue_manager.publish.assert_not_called()

    def test_handle_multimodal_image_content_with_error(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        sqlite_session: Session,
    ):
        """Test handling image content when an error occurs."""
        # Arrange
        image_url = "http://example.com/image.png"
        content = ImagePromptMessageContent(
            url=image_url,
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.side_effect = Exception("Network error")
            mock_mgr_class.return_value = mock_mgr

            result = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        assert result is None
        assert sqlite_session.scalar(select(func.count()).select_from(MessageFile)) == 0
        mock_queue_manager.publish.assert_not_called()

    def test_handle_multimodal_image_content_debugger_mode(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        tool_file,
        sqlite_session: Session,
    ):
        """Test that debugger mode sets correct created_by_role."""
        # Arrange
        image_url = "http://example.com/image.png"
        content = ImagePromptMessageContent(
            url=image_url,
            format="png",
            mime_type="image/png",
        )
        mock_queue_manager.invoke_from = InvokeFrom.DEBUGGER

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.return_value = tool_file
            mock_mgr_class.return_value = mock_mgr

            message_file_id = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        message_file = sqlite_session.get(MessageFile, message_file_id)
        assert message_file is not None
        assert message_file.created_by_role == CreatorUserRole.ACCOUNT

    def test_handle_multimodal_image_content_service_api_mode(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        tool_file,
        sqlite_session: Session,
    ):
        """Test that service API mode sets correct created_by_role."""
        # Arrange
        image_url = "http://example.com/image.png"
        content = ImagePromptMessageContent(
            url=image_url,
            format="png",
            mime_type="image/png",
        )
        mock_queue_manager.invoke_from = InvokeFrom.SERVICE_API

        with patch("core.app.apps.base_app_runner.ToolFileManager", autospec=True) as mock_mgr_class:
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.return_value = tool_file
            mock_mgr_class.return_value = mock_mgr

            message_file_id = AppRunner()._handle_multimodal_image_content(
                session=sqlite_session,
                content=content,
                message_id=mock_message_id,
                user_id=mock_user_id,
                tenant_id=mock_tenant_id,
                queue_manager=mock_queue_manager,
            )

        message_file = sqlite_session.get(MessageFile, message_file_id)
        assert message_file is not None
        assert message_file.created_by_role == CreatorUserRole.END_USER


@dataclass(eq=False, repr=False)
class _DummyParameterRule:
    name: str
    use_template: str | None = None


class _TokenCountingModel:
    token_count: int

    def __init__(self, token_count: int) -> None:
        self.token_count = token_count

    def get_llm_num_tokens(self, messages: list[AssistantPromptMessage]) -> int:
        return self.token_count


def _queue_manager() -> MessageBasedAppQueueManager:
    return MessageBasedAppQueueManager(
        task_id="task-id",
        user_id="user-id",
        invoke_from=InvokeFrom.SERVICE_API,
        conversation_id="conversation-id",
        app_mode=AppMode.CHAT.value,
        message_id="message-id",
    )


def _published_events(queue_manager: MessageBasedAppQueueManager) -> list[object]:
    return [message.event for message in queue_manager.listen()]


class _ClosableStream:
    def __init__(self, chunks: list[LLMResultChunk]) -> None:
        self._chunks = chunks
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        if not self._chunks:
            raise StopIteration
        return self._chunks.pop(0)

    def close(self) -> None:
        self.closed = True


class TestAppRunner:
    def test_recalc_llm_max_tokens_updates_parameters(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()

        model_schema = AIModelEntity.model_construct(
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 100},
            parameter_rules=[_DummyParameterRule("max_tokens")],
        )
        model_config = ModelConfigWithCredentialsEntity.model_construct(
            provider_model_bundle=object(),
            model="mock",
            model_schema=model_schema,
            parameters={"max_tokens": 30},
        )

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.ModelInstance",
            lambda provider_model_bundle, model: _TokenCountingModel(80),
        )

        runner.recalc_llm_max_tokens(model_config, prompt_messages=[AssistantPromptMessage(content="hi")])

        assert model_config.parameters["max_tokens"] == 20

    def test_recalc_llm_max_tokens_returns_minus_one_when_no_context(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()

        model_schema = AIModelEntity.model_construct(
            model_properties={},
            parameter_rules=[_DummyParameterRule("max_tokens")],
        )
        model_config = ModelConfigWithCredentialsEntity.model_construct(
            provider_model_bundle=object(),
            model="mock",
            model_schema=model_schema,
            parameters={"max_tokens": 30},
        )

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.ModelInstance",
            lambda provider_model_bundle, model: _TokenCountingModel(10),
        )

        assert runner.recalc_llm_max_tokens(model_config, prompt_messages=[]) == -1

    def test_direct_output_streaming_publishes_chunks_and_end(self):
        runner = AppRunner()
        queue = _queue_manager()
        model_config = ModelConfigWithCredentialsEntity.model_construct(model="mock")
        app_generate_entity = EasyUIBasedAppGenerateEntity.model_construct(model_conf=model_config, stream=True)

        runner.direct_output(
            queue_manager=queue,
            app_generate_entity=app_generate_entity,
            prompt_messages=[],
            text="hi",
            stream=True,
        )

        events = _published_events(queue)
        assert any(isinstance(event, QueueLLMChunkEvent) for event in events)
        assert isinstance(events[-1], QueueMessageEndEvent)

    def test_handle_invoke_result_direct_publishes_end_event(self):
        runner = AppRunner()
        queue = _queue_manager()
        llm_result = LLMResult(
            model="mock",
            prompt_messages=[],
            message=AssistantPromptMessage(content="done"),
            usage=LLMUsage.empty_usage(),
        )

        runner._handle_invoke_result(
            invoke_result=llm_result,
            queue_manager=queue,
            stream=False,
        )

        assert isinstance(_published_events(queue)[-1], QueueMessageEndEvent)

    def test_handle_invoke_result_invalid_type_raises(self):
        runner = AppRunner()
        queue = _queue_manager()

        with pytest.raises(NotImplementedError):
            runner._handle_invoke_result(
                invoke_result=["unexpected"],
                queue_manager=queue,
                stream=True,
            )

    def test_organize_prompt_messages_simple_template(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        model_config = ModelConfigWithCredentialsEntity.model_construct(mode="chat", stop=["STOP"])
        prompt_template_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="hello",
        )

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.SimplePromptTransform.get_prompt",
            lambda self, **kwargs: (["simple-message"], ["simple-stop"]),
        )

        prompt_messages, stop = runner.organize_prompt_messages(
            app_record=App(mode=AppMode.CHAT.value),
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs={},
            files=[],
            query="q",
        )

        assert prompt_messages == ["simple-message"]
        assert stop == ["simple-stop"]

    def test_organize_prompt_messages_advanced_completion_template(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        model_config = ModelConfigWithCredentialsEntity.model_construct(mode="completion", stop=["<END>"])
        captured: dict[str, object] = {}
        prompt_template_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
            advanced_completion_prompt_template=AdvancedCompletionPromptTemplateEntity(
                prompt="answer",
                role_prefix=AdvancedCompletionPromptTemplateEntity.RolePrefixEntity(user="U", assistant="A"),
            ),
        )

        def _fake_advanced_prompt(self, **kwargs):
            captured.update(kwargs)
            return ["advanced-completion-message"]

        monkeypatch.setattr("core.app.apps.base_app_runner.AdvancedPromptTransform.get_prompt", _fake_advanced_prompt)

        prompt_messages, stop = runner.organize_prompt_messages(
            app_record=App(mode=AppMode.CHAT.value),
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs={},
            files=[],
            query="q",
        )

        assert prompt_messages == ["advanced-completion-message"]
        assert stop == ["<END>"]
        memory_config = captured["memory_config"]
        assert memory_config.role_prefix.user == "U"
        assert memory_config.role_prefix.assistant == "A"

    def test_organize_prompt_messages_advanced_chat_template(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        model_config = ModelConfigWithCredentialsEntity.model_construct(mode="chat", stop=["<END>"])
        captured: dict[str, object] = {}
        prompt_template_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
            advanced_chat_prompt_template=AdvancedChatPromptTemplateEntity(
                messages=[
                    AdvancedChatMessageEntity(text="hello", role=PromptMessageRole.USER),
                    AdvancedChatMessageEntity(text="world", role=PromptMessageRole.ASSISTANT),
                ]
            ),
        )

        def _fake_advanced_prompt(self, **kwargs):
            captured.update(kwargs)
            return ["advanced-chat-message"]

        monkeypatch.setattr("core.app.apps.base_app_runner.AdvancedPromptTransform.get_prompt", _fake_advanced_prompt)

        prompt_messages, stop = runner.organize_prompt_messages(
            app_record=App(mode=AppMode.CHAT.value),
            model_config=model_config,
            prompt_template_entity=prompt_template_entity,
            inputs={},
            files=[],
            query="q",
        )

        assert prompt_messages == ["advanced-chat-message"]
        assert stop == ["<END>"]
        assert len(captured["prompt_template"]) == 2

    def test_organize_prompt_messages_advanced_missing_templates_raise(self):
        runner = AppRunner()

        with pytest.raises(InvokeBadRequestError, match="Advanced completion prompt template is required"):
            runner.organize_prompt_messages(
                app_record=App(mode=AppMode.CHAT.value),
                model_config=ModelConfigWithCredentialsEntity.model_construct(mode="completion", stop=[]),
                prompt_template_entity=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.ADVANCED),
                inputs={},
                files=[],
            )

        with pytest.raises(InvokeBadRequestError, match="Advanced chat prompt template is required"):
            runner.organize_prompt_messages(
                app_record=App(mode=AppMode.CHAT.value),
                model_config=ModelConfigWithCredentialsEntity.model_construct(mode="chat", stop=[]),
                prompt_template_entity=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.ADVANCED),
                inputs={},
                files=[],
            )

    def test_handle_invoke_result_stream_routes_chunks_and_builds_message(self, caplog: pytest.LogCaptureFixture):
        runner = AppRunner()
        queue = _queue_manager()

        image_content = ImagePromptMessageContent(
            url="https://example.com/image.png", format="png", mime_type="image/png"
        )

        def _stream():
            yield LLMResultChunk(
                model="stream-model",
                prompt_messages=[AssistantPromptMessage(content="prompt")],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content=[
                            TextPromptMessageContent(data="abc"),
                            image_content,
                        ]
                    ),
                ),
            )

        with caplog.at_level(logging.WARNING, logger="core.app.apps.base_app_runner"):
            runner._handle_invoke_result(
                invoke_result=_stream(),
                queue_manager=queue,
                stream=True,
                agent=False,
            )

        events = _published_events(queue)
        assert isinstance(events[0], QueueLLMChunkEvent)
        assert isinstance(events[-1], QueueMessageEndEvent)
        assert events[-1].llm_result.message.content == "abc"
        assert "Received multimodal output but missing required parameters" in caplog.messages

    def test_handle_invoke_result_stream_agent_mode_handles_multimodal_errors(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        runner = AppRunner()
        queue = _queue_manager()

        def raise_multimodal_error(**kwargs):
            raise RuntimeError("failed to save image")

        monkeypatch.setattr(
            runner,
            "_handle_multimodal_image_content",
            raise_multimodal_error,
        )
        usage = LLMUsage.empty_usage()

        def _stream():
            yield LLMResultChunk(
                model="agent-model",
                prompt_messages=[AssistantPromptMessage(content="prompt")],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content=[
                            ImagePromptMessageContent(
                                url="https://example.com/image.png",
                                format="png",
                                mime_type="image/png",
                            ),
                            TextPromptMessageContent(data="done"),
                        ]
                    ),
                    usage=usage,
                ),
            )

        with caplog.at_level(logging.ERROR, logger="core.app.apps.base_app_runner"):
            runner._handle_invoke_result_stream(
                invoke_result=_stream(),
                queue_manager=queue,
                agent=True,
                message_id="message-id",
                user_id="user-id",
                tenant_id="tenant-id",
            )

        events = _published_events(queue)
        assert isinstance(events[0], QueueAgentMessageEvent)
        assert isinstance(events[-1], QueueMessageEndEvent)
        assert events[-1].llm_result.usage == usage
        assert "Failed to handle multimodal image output" in caplog.messages

    def test_handle_invoke_result_stream_commits_message_file_before_publish(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ):
        runner = AppRunner()
        monkeypatch.setattr(
            runner,
            "_handle_multimodal_image_content",
            lambda **kwargs: "message-file-1",
        )
        events: list[str] = []

        def record_commit(session: Session) -> None:
            events.append("commit")

        event.listen(sqlite_session_factory.class_, "after_commit", record_commit)
        queue = _queue_manager()
        original_publish = queue.publish

        def publish(event, pub_from):
            if isinstance(event, QueueMessageFileEvent):
                events.append("publish")
            original_publish(event, pub_from)

        queue.publish = publish

        def stream():
            yield LLMResultChunk(
                model="model",
                prompt_messages=[AssistantPromptMessage(content="prompt")],
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content=[
                            ImagePromptMessageContent(
                                url="https://example.com/image.png",
                                format="png",
                                mime_type="image/png",
                            )
                        ]
                    ),
                ),
            )

        try:
            runner._handle_invoke_result_stream(
                invoke_result=stream(),
                queue_manager=queue,
                agent=False,
                message_id="message-1",
                user_id="user-1",
                tenant_id="tenant-1",
            )
        finally:
            event.remove(sqlite_session_factory.class_, "after_commit", record_commit)

        assert events == ["commit", "publish"]

    def test_handle_invoke_result_stream_closes_generator_when_stopped(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        chunk = LLMResultChunk(
            model="stream-model",
            prompt_messages=[AssistantPromptMessage(content="prompt")],
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="a")),
        )
        stream = _ClosableStream([chunk])

        queue_manager = _queue_manager()
        monkeypatch.setattr(queue_manager, "_is_stopped", lambda: True)

        with pytest.raises(GenerateTaskStoppedError):
            runner._handle_invoke_result_stream(
                invoke_result=stream,
                queue_manager=queue_manager,
                agent=False,
            )

        assert stream.closed is True

    @pytest.mark.parametrize("sqlite_session", [(MessageFile,)], indirect=True)
    def test_handle_multimodal_image_content_fallback_return_branch(
        self,
        sqlite_session: Session,
    ):
        runner = AppRunner()

        class _ToggleBool:
            def __init__(self, values: list[bool]):
                self._values = values
                self._index = 0

            def __bool__(self):
                value = self._values[min(self._index, len(self._values) - 1)]
                self._index += 1
                return value

        # The fallback is reachable only when the fields change truthiness between the guard and branch checks.
        content = ImagePromptMessageContent.model_construct(
            url=_ToggleBool([False, False]),
            base64_data=_ToggleBool([True, False]),
            mime_type="image/png",
        )

        queue_manager = _queue_manager()

        runner._handle_multimodal_image_content(
            session=sqlite_session,
            content=content,
            message_id="message-id",
            user_id="user-id",
            tenant_id="tenant-id",
            queue_manager=queue_manager,
        )

        message_file_count = sqlite_session.scalar(select(func.count()).select_from(MessageFile))
        assert message_file_count == 0

    def test_check_hosting_moderation_direct_output_called(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        queue = _queue_manager()
        app_generate_entity = EasyUIBasedAppGenerateEntity.model_construct(stream=False)
        direct_output_calls: list[dict[str, object]] = []

        monkeypatch.setattr(
            "core.app.apps.base_app_runner.HostingModerationFeature.check",
            lambda self, application_generate_entity, prompt_messages: True,
        )
        monkeypatch.setattr(runner, "direct_output", lambda **kwargs: direct_output_calls.append(kwargs))

        result = runner.check_hosting_moderation(
            application_generate_entity=app_generate_entity,
            queue_manager=queue,
            prompt_messages=[],
        )

        assert result is True
        assert len(direct_output_calls) == 1

    def test_fill_in_inputs_from_external_data_tools(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        monkeypatch.setattr(
            "core.app.apps.base_app_runner.ExternalDataFetch.fetch",
            lambda self, tenant_id, app_id, external_data_tools, inputs, query: {"foo": "bar"},
        )

        result = runner.fill_in_inputs_from_external_data_tools(
            tenant_id="tenant",
            app_id="app",
            external_data_tools=[],
            inputs={},
            query="q",
        )

        assert result == {"foo": "bar"}

    def test_moderation_for_inputs_returns_result(self, monkeypatch: pytest.MonkeyPatch):
        runner = AppRunner()
        monkeypatch.setattr(
            "core.app.apps.base_app_runner.InputModeration.check",
            lambda self, app_id, tenant_id, app_config, inputs, query, message_id, trace_manager: (True, {}, ""),
        )
        app_generate_entity = AppGenerateEntity.model_construct(app_config=None, trace_manager=None)

        result = runner.moderation_for_inputs(
            app_id="app",
            tenant_id="tenant",
            app_generate_entity=app_generate_entity,
            inputs={},
            query="q",
            message_id="msg",
        )

        assert result == (True, {}, "")

    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    def test_query_app_annotations_to_reply(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        runner = AppRunner()
        monkeypatch.setattr(
            "core.app.apps.base_app_runner.AnnotationReplyFeature.query",
            lambda self, app_record, message, query, user_id, invoke_from, session: "reply",
        )

        response = runner.query_app_annotations_to_reply(
            app_record=App(),
            message=Message(),
            query="hello",
            user_id="user",
            invoke_from=InvokeFrom.WEB_APP,
            session=sqlite_session,
        )

        assert response == "reply"
