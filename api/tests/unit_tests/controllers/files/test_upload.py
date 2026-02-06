import types
from unittest.mock import patch

import pytest
from werkzeug.exceptions import Forbidden

import controllers.files.upload as module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def fake_request(args: dict, file=None):
    return types.SimpleNamespace(
        args=types.SimpleNamespace(to_dict=lambda flat=True: args),
        files={"file": file} if file else {},
    )


class DummyUser:
    def __init__(self, user_id="user-1"):
        self.id = user_id


class DummyFile:
    def __init__(self, filename="test.txt", mimetype="text/plain", content=b"data"):
        self.filename = filename
        self.mimetype = mimetype
        self._content = content

    def read(self):
        return self._content


class DummyToolFile:
    def __init__(self):
        self.id = "file-id"
        self.name = "test.txt"
        self.size = 10
        self.mimetype = "text/plain"
        self.original_url = "http://original"
        self.user_id = "user-1"
        self.tenant_id = "tenant-1"
        self.conversation_id = None
        self.file_key = "file-key"


class TestPluginUploadFileApi:
    @patch.object(module, "verify_plugin_file_signature", return_value=True)
    @patch.object(module, "get_user", return_value=DummyUser())
    @patch.object(module, "ToolFileManager")
    def test_success_upload(
        self,
        mock_tool_file_manager,
        mock_get_user,
        mock_verify_signature,
    ):
        dummy_file = DummyFile()

        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "tenant_id": "tenant-1",
                "user_id": "user-1",
            },
            file=dummy_file,
        )

        tool_file_manager_instance = mock_tool_file_manager.return_value
        tool_file_manager_instance.create_file_by_raw.return_value = DummyToolFile()

        mock_tool_file_manager.sign_file.return_value = "signed-url"

        api = module.PluginUploadFileApi()
        post_fn = unwrap(api.post)

        result, status_code = post_fn(api)

        assert status_code == 201
        assert result["id"] == "file-id"
        assert result["preview_url"] == "signed-url"

    def test_missing_file(self):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "tenant_id": "tenant-1",
                "user_id": "user-1",
            }
        )

        api = module.PluginUploadFileApi()
        post_fn = unwrap(api.post)

        with pytest.raises(Forbidden):
            post_fn(api)

    @patch.object(module, "get_user", return_value=DummyUser())
    @patch.object(module, "verify_plugin_file_signature", return_value=False)
    def test_invalid_signature(self, mock_verify, mock_get_user):
        dummy_file = DummyFile()

        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "bad",
                "tenant_id": "tenant-1",
                "user_id": "user-1",
            },
            file=dummy_file,
        )

        api = module.PluginUploadFileApi()
        post_fn = unwrap(api.post)

        with pytest.raises(Forbidden):
            post_fn(api)

    @patch.object(module, "get_user", return_value=DummyUser())
    @patch.object(module, "verify_plugin_file_signature", return_value=True)
    @patch.object(module, "ToolFileManager")
    def test_file_too_large(
        self,
        mock_tool_file_manager,
        mock_verify,
        mock_get_user,
    ):
        dummy_file = DummyFile()

        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "tenant_id": "tenant-1",
                "user_id": "user-1",
            },
            file=dummy_file,
        )

        mock_tool_file_manager.return_value.create_file_by_raw.side_effect = (
            module.services.errors.file.FileTooLargeError("too large")
        )

        api = module.PluginUploadFileApi()
        post_fn = unwrap(api.post)

        with pytest.raises(module.FileTooLargeError):
            post_fn(api)

    @patch.object(module, "get_user", return_value=DummyUser())
    @patch.object(module, "verify_plugin_file_signature", return_value=True)
    @patch.object(module, "ToolFileManager")
    def test_unsupported_file_type(
        self,
        mock_tool_file_manager,
        mock_verify,
        mock_get_user,
    ):
        dummy_file = DummyFile()

        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "tenant_id": "tenant-1",
                "user_id": "user-1",
            },
            file=dummy_file,
        )

        mock_tool_file_manager.return_value.create_file_by_raw.side_effect = (
            module.services.errors.file.UnsupportedFileTypeError()
        )

        api = module.PluginUploadFileApi()
        post_fn = unwrap(api.post)

        with pytest.raises(module.UnsupportedFileTypeError):
            post_fn(api)
