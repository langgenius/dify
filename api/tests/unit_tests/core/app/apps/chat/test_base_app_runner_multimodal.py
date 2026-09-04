"""Test multimodal image output handling in BaseAppRunner."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.enums import CreatorUserRole
from models.model import MessageFile
from models.tools import ToolFile


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
