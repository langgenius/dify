import types
from unittest.mock import patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

import controllers.files.tool_files as module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def fake_request(args: dict):
    return types.SimpleNamespace(args=types.SimpleNamespace(to_dict=lambda flat=True: args))


class DummyToolFile:
    def __init__(self, mimetype="text/plain", size=10, name="tool.txt"):
        self.mimetype = mimetype
        self.size = size
        self.name = name


@pytest.fixture(autouse=True)
def mock_global_db():
    fake_db = types.SimpleNamespace(engine=object())
    module.global_db = fake_db


class TestToolFileApi:
    @patch.object(module, "verify_tool_file_signature", return_value=True)
    @patch.object(module, "ToolFileManager")
    def test_success_stream(
        self,
        mock_tool_file_manager,
        mock_verify,
    ):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            }
        )

        stream = iter([b"data"])
        tool_file = DummyToolFile(size=100)

        mock_tool_file_manager.return_value.get_file_generator_by_tool_file_id.return_value = (
            stream,
            tool_file,
        )

        api = module.ToolFileApi()
        get_fn = unwrap(api.get)

        response = get_fn("file-id", "txt")

        assert response.mimetype == "text/plain"
        assert response.headers["Content-Length"] == "100"
        mock_verify.assert_called_once_with(
            file_id="file-id",
            timestamp="123",
            nonce="abc",
            sign="sig",
        )

    @patch.object(module, "verify_tool_file_signature", return_value=True)
    @patch.object(module, "ToolFileManager")
    def test_as_attachment(
        self,
        mock_tool_file_manager,
        mock_verify,
    ):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": True,
            }
        )

        stream = iter([b"data"])
        tool_file = DummyToolFile(
            mimetype="application/pdf",
            name="doc.pdf",
        )

        mock_tool_file_manager.return_value.get_file_generator_by_tool_file_id.return_value = (
            stream,
            tool_file,
        )

        api = module.ToolFileApi()
        get_fn = unwrap(api.get)

        response = get_fn("file-id", "pdf")

        assert response.headers["Content-Disposition"].startswith("attachment")
        mock_verify.assert_called_once()

    @patch.object(module, "verify_tool_file_signature", return_value=False)
    def test_invalid_signature(self, mock_verify):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "bad-sig",
                "as_attachment": False,
            }
        )

        api = module.ToolFileApi()
        get_fn = unwrap(api.get)

        with pytest.raises(Forbidden):
            get_fn("file-id", "txt")

    @patch.object(module, "verify_tool_file_signature", return_value=True)
    @patch.object(module, "ToolFileManager")
    def test_file_not_found(
        self,
        mock_tool_file_manager,
        mock_verify,
    ):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            }
        )

        mock_tool_file_manager.return_value.get_file_generator_by_tool_file_id.return_value = (
            None,
            None,
        )

        api = module.ToolFileApi()
        get_fn = unwrap(api.get)

        with pytest.raises(NotFound):
            get_fn("file-id", "txt")

    @patch.object(module, "verify_tool_file_signature", return_value=True)
    @patch.object(module, "ToolFileManager")
    def test_unsupported_file_type(
        self,
        mock_tool_file_manager,
        mock_verify,
    ):
        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "as_attachment": False,
            }
        )

        mock_tool_file_manager.return_value.get_file_generator_by_tool_file_id.side_effect = Exception("boom")

        api = module.ToolFileApi()
        get_fn = unwrap(api.get)

        with pytest.raises(module.UnsupportedFileTypeError):
            get_fn("file-id", "txt")
