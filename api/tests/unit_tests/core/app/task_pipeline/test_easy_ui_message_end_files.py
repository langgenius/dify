"""
Unit tests for EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response method.

This test suite ensures that the files array is correctly populated in the message_end
SSE event, which is critical for vision/image chat responses to render correctly.

Test Coverage:
- Files array populated when MessageFile records exist
- Files array is None when no MessageFile records exist
- Correct signed URL generation for LOCAL_FILE transfer method
- Correct URL handling for REMOTE_URL transfer method
- Correct URL handling for TOOL_FILE transfer method
- Proper file metadata formatting (filename, mime_type, size, extension)
"""

import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.app.entities.task_entities import MessageEndStreamResponse
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.file.enums import FileTransferMethod
from models.model import MessageFile, UploadFile


class TestMessageEndStreamResponseFiles:
    """Test suite for files array population in message_end SSE event."""

    @pytest.fixture
    def mock_pipeline(self):
        """Create a mock EasyUIBasedGenerateTaskPipeline instance."""
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

    @pytest.fixture
    def mock_message_file_local(self):
        """Create a mock MessageFile with LOCAL_FILE transfer method."""
        message_file = Mock(spec=MessageFile)
        message_file.id = str(uuid.uuid4())
        message_file.message_id = str(uuid.uuid4())
        message_file.transfer_method = FileTransferMethod.LOCAL_FILE
        message_file.upload_file_id = str(uuid.uuid4())
        message_file.url = None
        message_file.type = "image"
        return message_file

    @pytest.fixture
    def mock_message_file_remote(self):
        """Create a mock MessageFile with REMOTE_URL transfer method."""
        message_file = Mock(spec=MessageFile)
        message_file.id = str(uuid.uuid4())
        message_file.message_id = str(uuid.uuid4())
        message_file.transfer_method = FileTransferMethod.REMOTE_URL
        message_file.upload_file_id = None
        message_file.url = "https://example.com/image.jpg"
        message_file.type = "image"
        return message_file

    @pytest.fixture
    def mock_message_file_tool(self):
        """Create a mock MessageFile with TOOL_FILE transfer method."""
        message_file = Mock(spec=MessageFile)
        message_file.id = str(uuid.uuid4())
        message_file.message_id = str(uuid.uuid4())
        message_file.transfer_method = FileTransferMethod.TOOL_FILE
        message_file.upload_file_id = None
        message_file.url = "tool_file_123.png"
        message_file.type = "image"
        return message_file

    @pytest.fixture
    def mock_upload_file(self, mock_message_file_local):
        """Create a mock UploadFile."""
        upload_file = Mock(spec=UploadFile)
        upload_file.id = mock_message_file_local.upload_file_id
        upload_file.name = "test_image.png"
        upload_file.mime_type = "image/png"
        upload_file.size = 1024
        upload_file.extension = "png"
        return upload_file

    def test_message_end_with_no_files(self, mock_pipeline):
        """Test that files array is None when no MessageFile records exist."""
        # Arrange
        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine

            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.scalars.return_value.all.return_value = []

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is None
            assert result.id == mock_pipeline._message_id
            assert result.metadata == {"test": "metadata"}

    def test_message_end_with_local_file(self, mock_pipeline, mock_message_file_local, mock_upload_file):
        """Test that files array is populated correctly for LOCAL_FILE transfer method."""
        # Arrange
        mock_message_file_local.message_id = mock_pipeline._message_id

        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
            patch(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.file_helpers.get_signed_file_url"
            ) as mock_get_url,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine

            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session

            # Mock database queries
            # First query: MessageFile
            mock_message_files_result = Mock()
            mock_message_files_result.all.return_value = [mock_message_file_local]

            # Second query: UploadFile (batch query to avoid N+1)
            mock_upload_files_result = Mock()
            mock_upload_files_result.all.return_value = [mock_upload_file]

            # Setup scalars to return different results for different queries
            call_count = [0]  # Use list to allow modification in nested function

            def scalars_side_effect(query):
                call_count[0] += 1
                # First call is for MessageFile, second call is for UploadFile
                if call_count[0] == 1:
                    return mock_message_files_result
                else:
                    return mock_upload_files_result

            mock_session.scalars.side_effect = scalars_side_effect
            mock_get_url.return_value = "https://example.com/signed-url?signature=abc123"

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is not None
            assert len(result.files) == 1

            file_dict = result.files[0]
            assert file_dict["related_id"] == mock_message_file_local.id
            assert file_dict["filename"] == "test_image.png"
            assert file_dict["mime_type"] == "image/png"
            assert file_dict["size"] == 1024
            assert file_dict["extension"] == ".png"
            assert file_dict["type"] == "image"
            assert file_dict["transfer_method"] == FileTransferMethod.LOCAL_FILE.value
            assert "https://example.com/signed-url" in file_dict["url"]
            assert file_dict["upload_file_id"] == mock_message_file_local.upload_file_id
            assert file_dict["remote_url"] == ""

            # Verify database queries
            # Should be called twice: once for MessageFile, once for UploadFile
            assert mock_session.scalars.call_count == 2
            mock_get_url.assert_called_once_with(upload_file_id=str(mock_upload_file.id))

    def test_message_end_with_remote_url(self, mock_pipeline, mock_message_file_remote):
        """Test that files array is populated correctly for REMOTE_URL transfer method."""
        # Arrange
        mock_message_file_remote.message_id = mock_pipeline._message_id

        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine
            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session

            # Mock database queries
            mock_scalars_result = Mock()
            mock_scalars_result.all.return_value = [mock_message_file_remote]
            mock_session.scalars.return_value = mock_scalars_result

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is not None
            assert len(result.files) == 1

            file_dict = result.files[0]
            assert file_dict["related_id"] == mock_message_file_remote.id
            assert file_dict["filename"] == "image.jpg"
            assert file_dict["url"] == "https://example.com/image.jpg"
            assert file_dict["extension"] == ".jpg"
            assert file_dict["type"] == "image"
            assert file_dict["transfer_method"] == FileTransferMethod.REMOTE_URL.value
            assert file_dict["remote_url"] == "https://example.com/image.jpg"
            assert file_dict["upload_file_id"] == mock_message_file_remote.id

            # Verify only one query for message_files is made
            mock_session.scalars.assert_called_once()

    def test_message_end_with_tool_file_http(self, mock_pipeline, mock_message_file_tool):
        """Test that files array is populated correctly for TOOL_FILE with HTTP URL."""
        # Arrange
        mock_message_file_tool.message_id = mock_pipeline._message_id
        mock_message_file_tool.url = "https://example.com/tool_file.png"

        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine
            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session

            # Mock database queries
            mock_scalars_result = Mock()
            mock_scalars_result.all.return_value = [mock_message_file_tool]
            mock_session.scalars.return_value = mock_scalars_result

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is not None
            assert len(result.files) == 1

            file_dict = result.files[0]
            assert file_dict["url"] == "https://example.com/tool_file.png"
            assert file_dict["filename"] == "tool_file.png"
            assert file_dict["extension"] == ".png"
            assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value

    def test_message_end_with_tool_file_local(self, mock_pipeline, mock_message_file_tool):
        """Test that files array is populated correctly for TOOL_FILE with local path."""
        # Arrange
        mock_message_file_tool.message_id = mock_pipeline._message_id
        mock_message_file_tool.url = "tool_file_123.png"

        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.sign_tool_file") as mock_sign_tool,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine

            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session

            # Mock database queries
            mock_scalars_result = Mock()
            mock_scalars_result.all.return_value = [mock_message_file_tool]
            mock_session.scalars.return_value = mock_scalars_result

            mock_sign_tool.return_value = "https://example.com/signed-tool-file.png?signature=xyz"

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is not None
            assert len(result.files) == 1

            file_dict = result.files[0]
            assert "https://example.com/signed-tool-file.png" in file_dict["url"]
            assert file_dict["filename"] == "tool_file_123.png"
            assert file_dict["extension"] == ".png"
            assert file_dict["transfer_method"] == FileTransferMethod.TOOL_FILE.value

            # Verify tool file signing was called
            mock_sign_tool.assert_called_once_with(tool_file_id="tool_file_123", extension=".png")

    def test_message_end_with_multiple_files(
        self, mock_pipeline, mock_message_file_local, mock_message_file_remote, mock_upload_file
    ):
        """Test that files array contains all MessageFile records when multiple exist."""
        # Arrange
        mock_message_file_local.message_id = mock_pipeline._message_id
        mock_message_file_remote.message_id = mock_pipeline._message_id

        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
            patch(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.file_helpers.get_signed_file_url"
            ) as mock_get_url,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine

            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session

            # Mock database queries
            # First query: MessageFile
            mock_message_files_result = Mock()
            mock_message_files_result.all.return_value = [mock_message_file_local, mock_message_file_remote]

            # Second query: UploadFile (batch query to avoid N+1)
            mock_upload_files_result = Mock()
            mock_upload_files_result.all.return_value = [mock_upload_file]

            # Setup scalars to return different results for different queries
            call_count = [0]  # Use list to allow modification in nested function

            def scalars_side_effect(query):
                call_count[0] += 1
                # First call is for MessageFile, second call is for UploadFile
                if call_count[0] == 1:
                    return mock_message_files_result
                else:
                    return mock_upload_files_result

            mock_session.scalars.side_effect = scalars_side_effect
            mock_get_url.return_value = "https://example.com/signed-url?signature=abc123"

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is not None
            assert len(result.files) == 2

            # Verify both files are present
            file_ids = [f["related_id"] for f in result.files]
            assert mock_message_file_local.id in file_ids
            assert mock_message_file_remote.id in file_ids

    def test_message_end_with_local_file_no_upload_file(self, mock_pipeline, mock_message_file_local):
        """Test fallback when UploadFile is not found for LOCAL_FILE."""
        # Arrange
        mock_message_file_local.message_id = mock_pipeline._message_id

        with (
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.db") as mock_db,
            patch("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.Session") as mock_session_class,
            patch(
                "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.file_helpers.get_signed_file_url"
            ) as mock_get_url,
        ):
            mock_engine = MagicMock()
            mock_db.engine = mock_engine

            mock_session = MagicMock(spec=Session)
            mock_session_class.return_value.__enter__.return_value = mock_session

            # Mock database queries
            # First query: MessageFile
            mock_message_files_result = Mock()
            mock_message_files_result.all.return_value = [mock_message_file_local]

            # Second query: UploadFile (batch query) - returns empty list (not found)
            mock_upload_files_result = Mock()
            mock_upload_files_result.all.return_value = []  # UploadFile not found

            # Setup scalars to return different results for different queries
            call_count = [0]  # Use list to allow modification in nested function

            def scalars_side_effect(query):
                call_count[0] += 1
                # First call is for MessageFile, second call is for UploadFile
                if call_count[0] == 1:
                    return mock_message_files_result
                else:
                    return mock_upload_files_result

            mock_session.scalars.side_effect = scalars_side_effect
            mock_get_url.return_value = "https://example.com/fallback-url?signature=def456"

            # Act
            result = EasyUIBasedGenerateTaskPipeline._message_end_to_stream_response(mock_pipeline)

            # Assert
            assert isinstance(result, MessageEndStreamResponse)
            assert result.files is not None
            assert len(result.files) == 1

            file_dict = result.files[0]
            assert "https://example.com/fallback-url" in file_dict["url"]
            # Verify fallback URL was generated using upload_file_id from message_file
            mock_get_url.assert_called_with(upload_file_id=str(mock_message_file_local.upload_file_id))
