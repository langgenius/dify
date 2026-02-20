from unittest.mock import MagicMock, patch

import pytest

from core.datasource.entities.datasource_entities import DatasourceMessage
from core.datasource.utils.message_transformer import DatasourceFileMessageTransformer
from core.workflow.file import File, FileTransferMethod, FileType
from models.tools import ToolFile


class TestDatasourceFileMessageTransformer:
    def test_transform_text_and_link_messages(self):
        # Setup
        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.TEXT, message=DatasourceMessage.TextMessage(text="hello")
            ),
            DatasourceMessage(
                type=DatasourceMessage.MessageType.LINK,
                message=DatasourceMessage.TextMessage(text="https://example.com"),
            ),
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 2
        assert result[0].type == DatasourceMessage.MessageType.TEXT
        assert result[0].message.text == "hello"
        assert result[1].type == DatasourceMessage.MessageType.LINK
        assert result[1].message.text == "https://example.com"

    @patch("core.datasource.utils.message_transformer.ToolFileManager")
    @patch("core.datasource.utils.message_transformer.guess_extension")
    def test_transform_image_message_success(self, mock_guess_ext, mock_tool_file_manager_cls):
        # Setup
        mock_manager = mock_tool_file_manager_cls.return_value
        mock_tool_file = MagicMock(spec=ToolFile)
        mock_tool_file.id = "file_id_123"
        mock_tool_file.mimetype = "image/png"
        mock_manager.create_file_by_url.return_value = mock_tool_file
        mock_guess_ext.return_value = ".png"

        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.IMAGE,
                message=DatasourceMessage.TextMessage(text="https://example.com/image.png"),
                meta={"some": "meta"},
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1", conversation_id="conv1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.IMAGE_LINK
        assert result[0].message.text == "/files/datasources/file_id_123.png"
        assert result[0].meta == {"some": "meta"}
        mock_manager.create_file_by_url.assert_called_once_with(
            user_id="user1", tenant_id="tenant1", file_url="https://example.com/image.png", conversation_id="conv1"
        )

    @patch("core.datasource.utils.message_transformer.ToolFileManager")
    def test_transform_image_message_failure(self, mock_tool_file_manager_cls):
        # Setup
        mock_manager = mock_tool_file_manager_cls.return_value
        mock_manager.create_file_by_url.side_effect = Exception("Download failed")

        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.IMAGE,
                message=DatasourceMessage.TextMessage(text="https://example.com/image.png"),
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.TEXT
        assert "Failed to download image" in result[0].message.text
        assert "Download failed" in result[0].message.text

    @patch("core.datasource.utils.message_transformer.ToolFileManager")
    @patch("core.datasource.utils.message_transformer.guess_extension")
    def test_transform_blob_message_image(self, mock_guess_ext, mock_tool_file_manager_cls):
        # Setup
        mock_manager = mock_tool_file_manager_cls.return_value
        mock_tool_file = MagicMock(spec=ToolFile)
        mock_tool_file.id = "blob_id_456"
        mock_tool_file.mimetype = "image/jpeg"
        mock_manager.create_file_by_raw.return_value = mock_tool_file
        mock_guess_ext.return_value = ".jpg"

        blob_data = b"fake-image-bits"
        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.BLOB,
                message=DatasourceMessage.BlobMessage(blob=blob_data),
                meta={"mime_type": "image/jpeg", "file_name": "test.jpg"},
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.IMAGE_LINK
        assert result[0].message.text == "/files/datasources/blob_id_456.jpg"
        mock_manager.create_file_by_raw.assert_called_once()

    @patch("core.datasource.utils.message_transformer.ToolFileManager")
    @patch("core.datasource.utils.message_transformer.guess_extension")
    @patch("core.datasource.utils.message_transformer.guess_type")
    def test_transform_blob_message_binary_guess_mimetype(
        self, mock_guess_type, mock_guess_ext, mock_tool_file_manager_cls
    ):
        # Setup
        mock_manager = mock_tool_file_manager_cls.return_value
        mock_tool_file = MagicMock(spec=ToolFile)
        mock_tool_file.id = "blob_id_789"
        mock_tool_file.mimetype = "application/pdf"
        mock_manager.create_file_by_raw.return_value = mock_tool_file
        mock_guess_type.return_value = ("application/pdf", None)
        mock_guess_ext.return_value = ".pdf"

        blob_data = b"fake-pdf-bits"
        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.BLOB,
                message=DatasourceMessage.BlobMessage(blob=blob_data),
                meta={"file_name": "test.pdf"},
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.BINARY_LINK
        assert result[0].message.text == "/files/datasources/blob_id_789.pdf"

    def test_transform_blob_message_invalid_type(self):
        # Setup
        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.BLOB, message=DatasourceMessage.TextMessage(text="not a blob")
            )
        ]

        # Execute & Verify
        with pytest.raises(ValueError, match="unexpected message type"):
            list(
                DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                    messages=iter(messages), user_id="user1", tenant_id="tenant1"
                )
            )

    def test_transform_file_tool_file_image(self):
        # Setup
        mock_file = MagicMock(spec=File)
        mock_file.transfer_method = FileTransferMethod.TOOL_FILE
        mock_file.related_id = "related_123"
        mock_file.extension = ".png"
        mock_file.type = FileType.IMAGE

        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.FILE,
                message=DatasourceMessage.TextMessage(text="ignored"),
                meta={"file": mock_file},
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.IMAGE_LINK
        assert result[0].message.text == "/files/datasources/related_123.png"

    def test_transform_file_tool_file_binary(self):
        # Setup
        mock_file = MagicMock(spec=File)
        mock_file.transfer_method = FileTransferMethod.TOOL_FILE
        mock_file.related_id = "related_456"
        mock_file.extension = ".txt"
        mock_file.type = FileType.DOCUMENT

        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.FILE,
                message=DatasourceMessage.TextMessage(text="ignored"),
                meta={"file": mock_file},
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.LINK
        assert result[0].message.text == "/files/datasources/related_456.txt"

    def test_transform_file_other_transfer_method(self):
        # Setup
        mock_file = MagicMock(spec=File)
        mock_file.transfer_method = FileTransferMethod.REMOTE_URL

        msg = DatasourceMessage(
            type=DatasourceMessage.MessageType.FILE,
            message=DatasourceMessage.TextMessage(text="remote image"),
            meta={"file": mock_file},
        )
        messages = [msg]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0] == msg

    def test_transform_other_message_type(self):
        # JSON type is yielded by the default 'else' block or the 'yield message' at the end
        msg = DatasourceMessage(
            type=DatasourceMessage.MessageType.JSON, message=DatasourceMessage.JsonMessage(json_object={"k": "v"})
        )
        messages = [msg]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify
        assert len(result) == 1
        assert result[0] == msg

    def test_get_datasource_file_url(self):
        # Test with extension
        url = DatasourceFileMessageTransformer.get_datasource_file_url("file1", ".jpg")
        assert url == "/files/datasources/file1.jpg"

        # Test without extension
        url = DatasourceFileMessageTransformer.get_datasource_file_url("file2", None)
        assert url == "/files/datasources/file2.bin"

    def test_transform_blob_message_no_meta_filename(self):
        # This tests line 70 where filename might be None
        with patch("core.datasource.utils.message_transformer.ToolFileManager") as mock_tool_file_manager_cls:
            mock_manager = mock_tool_file_manager_cls.return_value
            mock_tool_file = MagicMock(spec=ToolFile)
            mock_tool_file.id = "blob_id_no_name"
            mock_tool_file.mimetype = "application/octet-stream"
            mock_manager.create_file_by_raw.return_value = mock_tool_file

            messages = [
                DatasourceMessage(
                    type=DatasourceMessage.MessageType.BLOB,
                    message=DatasourceMessage.BlobMessage(blob=b"data"),
                    meta={},  # No mime_type, no file_name
                )
            ]

            result = list(
                DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                    messages=iter(messages), user_id="user1", tenant_id="tenant1"
                )
            )

            assert len(result) == 1
            assert result[0].type == DatasourceMessage.MessageType.BINARY_LINK
            assert result[0].message.text == "/files/datasources/blob_id_no_name.bin"

    @patch("core.datasource.utils.message_transformer.ToolFileManager")
    def test_transform_image_message_not_text_message(self, mock_tool_file_manager_cls):
        # This tests line 24-26 where it checks if message is instance of TextMessage
        messages = [
            DatasourceMessage(
                type=DatasourceMessage.MessageType.IMAGE, message=DatasourceMessage.BlobMessage(blob=b"not-text")
            )
        ]

        # Execute
        result = list(
            DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
                messages=iter(messages), user_id="user1", tenant_id="tenant1"
            )
        )

        # Verify - should yield unchanged if it's not a TextMessage
        assert len(result) == 1
        assert result[0].type == DatasourceMessage.MessageType.IMAGE
        assert isinstance(result[0].message, DatasourceMessage.BlobMessage)
