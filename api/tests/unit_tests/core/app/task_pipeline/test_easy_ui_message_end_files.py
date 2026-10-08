"""Exercise message-end file serialization against persisted SQLite rows.

The suite covers empty results, all transfer methods, upload metadata batching,
and the fallback used when a local message file references a missing upload.
"""

import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, InvokeFrom
from core.app.entities.task_entities import MessageEndStreamResponse
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from extensions.ext_redis import RedisClientWrapper
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import AppMode, Conversation, Message, MessageFile, UploadFile
from tests.unit_tests.core.model_fixtures import make_model_config

SQLITE_MODELS = (MessageFile, UploadFile)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


class TestMessageEndStreamResponseFiles:
    """Verify message-end file payloads from actual ORM query results."""

    @pytest.fixture(autouse=True)
    def bind_sqlite_engine(self, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
        """Bind sessions opened by the pipeline to the per-test SQLite engine."""

        sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_maker)

    @pytest.fixture
    def pipeline(
        self, monkeypatch: pytest.MonkeyPatch, redis_transport: tuple[RedisClientWrapper, MagicMock]
    ) -> EasyUIBasedGenerateTaskPipeline:
        """Construct the pipeline with validated request, model, and task state."""
        monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis_transport[0])
        request = ChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=EasyUIBasedAppConfig(
                tenant_id="tenant-id",
                app_id="app-id",
                app_mode=AppMode.CHAT,
                app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
                app_model_config_dict={},
                model=ModelConfigEntity(provider="test-provider", model="test-model"),
                prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
            ),
            model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
            inputs={},
            files=[],
            user_id="user-id",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
        )
        conversation = Conversation(
            id=str(uuid.uuid4()),
            app_id="app-id",
            mode=AppMode.CHAT,
            name="Conversation",
            from_source=ConversationFromSource.API,
            inputs={},
        )
        message = Message(id=str(uuid.uuid4()), created_at=datetime.now())
        queue = MessageBasedAppQueueManager(
            task_id=request.task_id,
            user_id=request.user_id,
            invoke_from=request.invoke_from,
            conversation_id=conversation.id,
            app_mode=AppMode.CHAT,
            message_id=message.id,
        )
        return EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=request,
            queue_manager=queue,
            conversation=conversation,
            message=message,
            stream=True,
        )

    @staticmethod
    def _message_file(
        *,
        transfer_method: FileTransferMethod,
        url: str | None = None,
        upload_file_id: str | None = None,
    ) -> MessageFile:
        return MessageFile(
            message_id=str(uuid.uuid4()),
            type=FileType.IMAGE,
            transfer_method=transfer_method,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid.uuid4()),
            url=url,
            upload_file_id=upload_file_id,
        )

    @pytest.fixture
    def message_file_local(self) -> MessageFile:
        """Create an unpersisted local-file row."""

        return self._message_file(
            transfer_method=FileTransferMethod.LOCAL_FILE,
            upload_file_id=str(uuid.uuid4()),
        )

    @pytest.fixture
    def message_file_remote(self) -> MessageFile:
        """Create an unpersisted remote-file row."""

        return self._message_file(
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="https://example.com/image.jpg",
        )

    @pytest.fixture
    def message_file_tool(self) -> MessageFile:
        """Create an unpersisted tool-file row."""

        return self._message_file(
            transfer_method=FileTransferMethod.TOOL_FILE,
            url="tool_file_123.png",
        )

    @pytest.fixture
    def upload_file(self, message_file_local: MessageFile) -> UploadFile:
        """Create upload metadata matching the local message-file reference."""

        upload = UploadFile(
            tenant_id=str(uuid.uuid4()),
            storage_type=StorageType.LOCAL,
            key="uploads/test_image.png",
            name="test_image.png",
            size=1024,
            extension="png",
            mime_type="image/png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid.uuid4()),
            created_at=datetime.now(),
            used=True,
        )
        upload.id = message_file_local.upload_file_id or str(uuid.uuid4())
        return upload

    @staticmethod
    def _persist(session: Session, *rows: MessageFile | UploadFile) -> None:
        session.add_all(rows)
        session.commit()

    def test_message_end_with_no_files(
        self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline
    ) -> None:
        """Rows for another message do not leak into an empty files array."""

        unrelated_file = self._message_file(
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="https://example.com/unrelated.png",
        )
        self._persist(sqlite_session, unrelated_file)

        result = pipeline._message_end_to_stream_response()

        assert sqlite_session.get(MessageFile, unrelated_file.id) is unrelated_file
        assert isinstance(result, MessageEndStreamResponse)
        assert result.files == []
        assert result.id == pipeline._message_id
        assert result.metadata == {
            "usage": pipeline._task_state.llm_result.usage.model_dump(exclude_none=True),
            "retriever_resources": [],
            "reasoning": {},
        }

    def test_message_end_with_local_file(
        self,
        sqlite_session: Session,
        pipeline: EasyUIBasedGenerateTaskPipeline,
        message_file_local: MessageFile,
        upload_file: UploadFile,
    ) -> None:
        """Local files include persisted upload metadata and a signed URL."""

        message_file_local.message_id = pipeline._message_id
        self._persist(sqlite_session, message_file_local, upload_file)

        with patch(
            "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
            return_value="https://example.com/signed-url?signature=abc123",
        ) as get_signed_url:
            result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        assert len(result.files) == 1
        file_dict = result.files[0]
        assert file_dict["related_id"] == message_file_local.id
        assert file_dict["filename"] == "test_image.png"
        assert file_dict["mime_type"] == "image/png"
        assert file_dict["size"] == 1024
        assert file_dict["extension"] == ".png"
        assert file_dict["type"] == "image"
        assert file_dict["transfer_method"] == FileTransferMethod.LOCAL_FILE.value
        assert file_dict["url"].startswith("https://example.com/signed-url")
        assert file_dict["upload_file_id"] == message_file_local.upload_file_id
        assert file_dict["remote_url"] == ""
        get_signed_url.assert_called_once_with(upload_file_id=upload_file.id)

    def test_message_end_with_remote_url(
        self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_remote: MessageFile
    ) -> None:
        """Remote files retain their source URL and derived filename."""

        message_file_remote.message_id = pipeline._message_id
        self._persist(sqlite_session, message_file_remote)

        result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        assert len(result.files) == 1
        file_dict = result.files[0]
        assert file_dict["related_id"] == message_file_remote.id
        assert file_dict["filename"] == "image.jpg"
        assert file_dict["url"] == "https://example.com/image.jpg"
        assert file_dict["extension"] == ".jpg"
        assert file_dict["type"] == "image"
        assert file_dict["transfer_method"] == FileTransferMethod.REMOTE_URL.value
        assert file_dict["remote_url"] == "https://example.com/image.jpg"
        assert file_dict["upload_file_id"] == message_file_remote.id

    def test_message_end_with_tool_file_http(
        self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_tool: MessageFile
    ) -> None:
        """HTTP tool-file URLs pass through unchanged."""

        message_file_tool.message_id = pipeline._message_id
        message_file_tool.url = "https://example.com/tool_file.png"
        self._persist(sqlite_session, message_file_tool)

        result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        file_dict = result.files[0]
        assert file_dict["url"] == "https://example.com/tool_file.png"
        assert file_dict["filename"] == "tool_file.png"
        assert file_dict["extension"] == ".png"
        assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value

    def test_message_end_with_tool_file_local(
        self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_tool: MessageFile
    ) -> None:
        """Local tool-file identifiers are signed at the external boundary."""

        message_file_tool.message_id = pipeline._message_id
        self._persist(sqlite_session, message_file_tool)

        with patch(
            "core.app.task_pipeline.message_file_utils.sign_tool_file",
            return_value="https://example.com/signed-tool-file.png?signature=xyz",
        ) as sign_tool:
            result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        file_dict = result.files[0]
        assert file_dict["url"].startswith("https://example.com/signed-tool-file.png")
        assert file_dict["filename"] == "tool_file_123.png"
        assert file_dict["extension"] == ".png"
        assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value
        sign_tool.assert_called_once_with(tool_file_id="tool_file_123", extension=".png")

    def test_message_end_with_tool_file_long_extension(
        self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_tool: MessageFile
    ) -> None:
        """Overlong tool-file extensions use the safe binary fallback."""

        message_file_tool.message_id = pipeline._message_id
        message_file_tool.url = "tool_file_abc.verylongextension"
        self._persist(sqlite_session, message_file_tool)

        with patch(
            "core.app.task_pipeline.message_file_utils.sign_tool_file",
            return_value="https://example.com/signed.bin",
        ) as sign_tool:
            result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        assert result.files[0]["extension"] == ".bin"
        sign_tool.assert_called_once_with(tool_file_id="tool_file_abc", extension=".bin")

    def test_message_end_with_multiple_files(
        self,
        sqlite_session: Session,
        pipeline: EasyUIBasedGenerateTaskPipeline,
        message_file_local: MessageFile,
        message_file_remote: MessageFile,
        upload_file: UploadFile,
    ) -> None:
        """The response contains every persisted file associated with the message."""

        message_file_local.message_id = pipeline._message_id
        message_file_remote.message_id = pipeline._message_id
        self._persist(sqlite_session, message_file_local, message_file_remote, upload_file)

        with patch(
            "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
            return_value="https://example.com/signed-url?signature=abc123",
        ):
            result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        assert {file["related_id"] for file in result.files} == {message_file_local.id, message_file_remote.id}

    def test_message_end_with_local_file_no_upload_file(
        self, sqlite_session: Session, pipeline: EasyUIBasedGenerateTaskPipeline, message_file_local: MessageFile
    ) -> None:
        """A missing upload row still signs the stored upload identifier."""

        message_file_local.message_id = pipeline._message_id
        self._persist(sqlite_session, message_file_local)

        with patch(
            "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
            return_value="https://example.com/fallback-url?signature=def456",
        ) as get_signed_url:
            result = pipeline._message_end_to_stream_response()

        assert result.files is not None
        assert len(result.files) == 1
        assert result.files[0]["url"].startswith("https://example.com/fallback-url")
        get_signed_url.assert_called_once_with(upload_file_id=str(message_file_local.upload_file_id))
