"""Exercise message-end file serialization against persisted SQLite rows.

The suite covers empty results, all transfer methods, upload metadata batching,
and the fallback used when a local message file references a missing upload.
"""

import uuid
from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.task_entities import MessageEndStreamResponse
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from models.enums import CreatorUserRole
from models.model import MessageFile, UploadFile

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
    def mock_pipeline(self) -> Mock:
        """Create the minimal pipeline collaborator required by the method under test."""

        pipeline = Mock(spec=EasyUIBasedGenerateTaskPipeline)
        pipeline._message_id = str(uuid.uuid4())
        pipeline._task_state = Mock()
        pipeline._task_state.metadata = Mock()
        pipeline._task_state.metadata.model_dump = Mock(return_value={"test": "metadata"})
        pipeline._task_state.llm_result = Mock()
        pipeline._task_state.llm_result.usage = Mock()
        pipeline._application_generate_entity = Mock()
        pipeline._application_generate_entity.task_id = str(uuid.uuid4())
        return pipeline

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

    def test_message_end_with_no_files(self, sqlite_session: Session, mock_pipeline: Mock) -> None:
        """Rows for another message do not leak into an empty files array."""

        unrelated_file = self._message_file(
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="https://example.com/unrelated.png",
        )
        self._persist(sqlite_session, unrelated_file)

        result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

        assert sqlite_session.get(MessageFile, unrelated_file.id) is unrelated_file
        assert isinstance(result, MessageEndStreamResponse)
        assert result.files == []
        assert result.id == mock_pipeline._message_id
        assert result.metadata == {"test": "metadata"}
        mock_pipeline._task_state.metadata.model_dump.assert_called_once_with(exclude_none=True)

    def test_message_end_with_local_file(
        self,
        sqlite_session: Session,
        mock_pipeline: Mock,
        message_file_local: MessageFile,
        upload_file: UploadFile,
    ) -> None:
        """Local files include persisted upload metadata and a signed URL."""

        message_file_local.message_id = mock_pipeline._message_id
        self._persist(sqlite_session, message_file_local, upload_file)

        with patch(
            "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
            return_value="https://example.com/signed-url?signature=abc123",
        ) as get_signed_url:
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

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
        get_signed_url.assert_called_once_with(upload_file_id=str(upload_file.id))

    def test_message_end_with_remote_url(
        self, sqlite_session: Session, mock_pipeline: Mock, message_file_remote: MessageFile
    ) -> None:
        """Remote files retain their source URL and derived filename."""

        message_file_remote.message_id = mock_pipeline._message_id
        self._persist(sqlite_session, message_file_remote)

        result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

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
        self, sqlite_session: Session, mock_pipeline: Mock, message_file_tool: MessageFile
    ) -> None:
        """HTTP tool-file URLs pass through unchanged."""

        message_file_tool.message_id = mock_pipeline._message_id
        message_file_tool.url = "https://example.com/tool_file.png"
        self._persist(sqlite_session, message_file_tool)

        result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

        assert result.files is not None
        file_dict = result.files[0]
        assert file_dict["url"] == "https://example.com/tool_file.png"
        assert file_dict["filename"] == "tool_file.png"
        assert file_dict["extension"] == ".png"
        assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value

    def test_message_end_with_tool_file_local(
        self, sqlite_session: Session, mock_pipeline: Mock, message_file_tool: MessageFile
    ) -> None:
        """Local tool-file identifiers are signed at the external boundary."""

        message_file_tool.message_id = mock_pipeline._message_id
        self._persist(sqlite_session, message_file_tool)

        with patch(
            "core.app.task_pipeline.message_file_utils.sign_tool_file",
            return_value="https://example.com/signed-tool-file.png?signature=xyz",
        ) as sign_tool:
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

        assert result.files is not None
        file_dict = result.files[0]
        assert file_dict["url"].startswith("https://example.com/signed-tool-file.png")
        assert file_dict["filename"] == "tool_file_123.png"
        assert file_dict["extension"] == ".png"
        assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value
        sign_tool.assert_called_once_with(tool_file_id="tool_file_123", extension=".png")

    def test_message_end_with_tool_file_long_extension(
        self, sqlite_session: Session, mock_pipeline: Mock, message_file_tool: MessageFile
    ) -> None:
        """Overlong tool-file extensions use the safe binary fallback."""

        message_file_tool.message_id = mock_pipeline._message_id
        message_file_tool.url = "tool_file_abc.verylongextension"
        self._persist(sqlite_session, message_file_tool)

        with patch(
            "core.app.task_pipeline.message_file_utils.sign_tool_file",
            return_value="https://example.com/signed.bin",
        ) as sign_tool:
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

        assert result.files is not None
        assert result.files[0]["extension"] == ".bin"
        sign_tool.assert_called_once_with(tool_file_id="tool_file_abc", extension=".bin")

    def test_message_end_with_multiple_files(
        self,
        sqlite_session: Session,
        mock_pipeline: Mock,
        message_file_local: MessageFile,
        message_file_remote: MessageFile,
        upload_file: UploadFile,
    ) -> None:
        """The response contains every persisted file associated with the message."""

        message_file_local.message_id = mock_pipeline._message_id
        message_file_remote.message_id = mock_pipeline._message_id
        self._persist(sqlite_session, message_file_local, message_file_remote, upload_file)

        with patch(
            "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
            return_value="https://example.com/signed-url?signature=abc123",
        ):
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

        assert result.files is not None
        assert {file["related_id"] for file in result.files} == {message_file_local.id, message_file_remote.id}

    def test_message_end_with_local_file_no_upload_file(
        self, sqlite_session: Session, mock_pipeline: Mock, message_file_local: MessageFile
    ) -> None:
        """A missing upload row still signs the stored upload identifier."""

        message_file_local.message_id = mock_pipeline._message_id
        self._persist(sqlite_session, message_file_local)

        with patch(
            "core.app.task_pipeline.message_file_utils.file_helpers.get_signed_file_url",
            return_value="https://example.com/fallback-url?signature=def456",
        ) as get_signed_url:
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

        assert result.files is not None
        assert len(result.files) == 1
        assert result.files[0]["url"].startswith("https://example.com/fallback-url")
        get_signed_url.assert_called_once_with(upload_file_id=str(message_file_local.upload_file_id))
