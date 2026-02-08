"""Test multimodal image output handling in BaseAppRunner."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueMessageFileEvent
from core.file.enums import FileTransferMethod, FileType
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.enums import CreatorUserRole


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
    def mock_tool_file(self):
        """Create a mock tool file."""
        tool_file = MagicMock()
        tool_file.id = str(uuid4())
        return tool_file

    @pytest.fixture
    def mock_message_file(self):
        """Create a mock message file."""
        message_file = MagicMock()
        message_file.id = str(uuid4())
        return message_file

    def test_handle_multimodal_image_content_with_url(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        mock_tool_file,
        mock_message_file,
    ):
        """Test handling image from URL."""
        # Arrange
        image_url = "http://example.com/image.png"
        content = ImagePromptMessageContent(
            url=image_url,
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.return_value = mock_tool_file
            mock_mgr_class.return_value = mock_mgr

            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                # Setup mock message file
                mock_msg_file_class.return_value = mock_message_file

                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    mock_session.add = MagicMock()
                    mock_session.commit = MagicMock()
                    mock_session.refresh = MagicMock()

                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()

                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert
                    # Verify tool file was created from URL
                    mock_mgr.create_file_by_url.assert_called_once_with(
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        file_url=image_url,
                        conversation_id=None,
                    )

                    # Verify message file was created with correct parameters
                    mock_msg_file_class.assert_called_once()
                    call_kwargs = mock_msg_file_class.call_args[1]
                    assert call_kwargs["message_id"] == mock_message_id
                    assert call_kwargs["type"] == FileType.IMAGE
                    assert call_kwargs["transfer_method"] == FileTransferMethod.TOOL_FILE
                    assert call_kwargs["belongs_to"] == "assistant"
                    assert call_kwargs["created_by"] == mock_user_id

                    # Verify database operations
                    mock_session.add.assert_called_once_with(mock_message_file)
                    mock_session.commit.assert_called_once()
                    mock_session.refresh.assert_called_once_with(mock_message_file)

                    # Verify event was published
                    mock_queue_manager.publish.assert_called_once()
                    publish_call = mock_queue_manager.publish.call_args
                    assert isinstance(publish_call[0][0], QueueMessageFileEvent)
                    assert publish_call[0][0].message_file_id == mock_message_file.id
                    # publish_from might be passed as positional or keyword argument
                    assert (
                        publish_call[0][1] == PublishFrom.APPLICATION_MANAGER
                        or publish_call.kwargs.get("publish_from") == PublishFrom.APPLICATION_MANAGER
                    )

    def test_handle_multimodal_image_content_with_base64(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        mock_tool_file,
        mock_message_file,
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

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_raw.return_value = mock_tool_file
            mock_mgr_class.return_value = mock_mgr

            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                # Setup mock message file
                mock_msg_file_class.return_value = mock_message_file

                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    mock_session.add = MagicMock()
                    mock_session.commit = MagicMock()
                    mock_session.refresh = MagicMock()

                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()
                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert
                    # Verify tool file was created from base64
                    mock_mgr.create_file_by_raw.assert_called_once()
                    call_kwargs = mock_mgr.create_file_by_raw.call_args[1]
                    assert call_kwargs["user_id"] == mock_user_id
                    assert call_kwargs["tenant_id"] == mock_tenant_id
                    assert call_kwargs["conversation_id"] is None
                    assert "file_binary" in call_kwargs
                    assert call_kwargs["mimetype"] == "image/png"
                    assert call_kwargs["filename"].startswith("generated_image")
                    assert call_kwargs["filename"].endswith(".png")

                    # Verify message file was created
                    mock_msg_file_class.assert_called_once()

                    # Verify database operations
                    mock_session.add.assert_called_once()
                    mock_session.commit.assert_called_once()
                    mock_session.refresh.assert_called_once()

                    # Verify event was published
                    mock_queue_manager.publish.assert_called_once()

    def test_handle_multimodal_image_content_with_base64_data_uri(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        mock_tool_file,
        mock_message_file,
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

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_raw.return_value = mock_tool_file
            mock_mgr_class.return_value = mock_mgr

            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                # Setup mock message file
                mock_msg_file_class.return_value = mock_message_file

                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    mock_session.add = MagicMock()
                    mock_session.commit = MagicMock()
                    mock_session.refresh = MagicMock()

                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()
                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert - verify that base64 data was extracted correctly (without prefix)
                    mock_mgr.create_file_by_raw.assert_called_once()
                    call_kwargs = mock_mgr.create_file_by_raw.call_args[1]
                    # The base64 data should be decoded, so we check the binary was passed
                    assert "file_binary" in call_kwargs

    def test_handle_multimodal_image_content_without_url_or_base64(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
    ):
        """Test handling image content without URL or base64 data."""
        # Arrange
        content = ImagePromptMessageContent(
            url="",
            base64_data="",
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()
                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert - should not create any files or publish events
                    mock_mgr_class.assert_not_called()
                    mock_msg_file_class.assert_not_called()
                    mock_session.add.assert_not_called()
                    mock_queue_manager.publish.assert_not_called()

    def test_handle_multimodal_image_content_with_error(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
    ):
        """Test handling image content when an error occurs."""
        # Arrange
        image_url = "http://example.com/image.png"
        content = ImagePromptMessageContent(
            url=image_url,
            format="png",
            mime_type="image/png",
        )

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            # Setup mock to raise exception
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.side_effect = Exception("Network error")
            mock_mgr_class.return_value = mock_mgr

            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()
                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    # Should not raise exception, just log it
                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert - should not create message file or publish event on error
                    mock_msg_file_class.assert_not_called()
                    mock_session.add.assert_not_called()
                    mock_queue_manager.publish.assert_not_called()

    def test_handle_multimodal_image_content_debugger_mode(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        mock_tool_file,
        mock_message_file,
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

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.return_value = mock_tool_file
            mock_mgr_class.return_value = mock_mgr

            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                # Setup mock message file
                mock_msg_file_class.return_value = mock_message_file

                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    mock_session.add = MagicMock()
                    mock_session.commit = MagicMock()
                    mock_session.refresh = MagicMock()

                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()
                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert - verify created_by_role is ACCOUNT for debugger mode
                    call_kwargs = mock_msg_file_class.call_args[1]
                    assert call_kwargs["created_by_role"] == CreatorUserRole.ACCOUNT

    def test_handle_multimodal_image_content_service_api_mode(
        self,
        mock_user_id,
        mock_tenant_id,
        mock_message_id,
        mock_queue_manager,
        mock_tool_file,
        mock_message_file,
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

        with patch("core.app.apps.base_app_runner.ToolFileManager") as mock_mgr_class:
            # Setup mock tool file manager
            mock_mgr = MagicMock()
            mock_mgr.create_file_by_url.return_value = mock_tool_file
            mock_mgr_class.return_value = mock_mgr

            with patch("core.app.apps.base_app_runner.MessageFile") as mock_msg_file_class:
                # Setup mock message file
                mock_msg_file_class.return_value = mock_message_file

                with patch("core.app.apps.base_app_runner.db.session") as mock_session:
                    mock_session.add = MagicMock()
                    mock_session.commit = MagicMock()
                    mock_session.refresh = MagicMock()

                    # Act
                    # Create a mock runner with the method bound
                    runner = MagicMock()
                    method = AppRunner._handle_multimodal_image_content
                    runner._handle_multimodal_image_content = lambda *args, **kwargs: method(runner, *args, **kwargs)

                    runner._handle_multimodal_image_content(
                        content=content,
                        message_id=mock_message_id,
                        user_id=mock_user_id,
                        tenant_id=mock_tenant_id,
                        queue_manager=mock_queue_manager,
                    )

                    # Assert - verify created_by_role is END_USER for service API
                    call_kwargs = mock_msg_file_class.call_args[1]
                    assert call_kwargs["created_by_role"] == CreatorUserRole.END_USER
