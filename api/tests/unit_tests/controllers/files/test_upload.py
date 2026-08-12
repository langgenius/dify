import io
import types
from contextlib import contextmanager
from inspect import unwrap
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

import controllers.files.upload as module
from core.workflow.file_reference import build_file_reference
from models import Account, TenantAccountJoin
from models.account import AccountStatus


def fake_request(args: dict, file=None):
    return types.SimpleNamespace(
        args=types.SimpleNamespace(to_dict=lambda flat=True: args),
        files={"file": file} if file else {},
    )


def _persist_account_memberships(session: Session) -> None:
    account = Account(name="Tenant member", email="member@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    decoy = Account(name="Other tenant member", email="decoy@example.com", status=AccountStatus.ACTIVE)
    decoy.id = "account-outside-tenant"
    session.add_all(
        [
            account,
            decoy,
            TenantAccountJoin(tenant_id="tenant-1", account_id=account.id),
            TenantAccountJoin(tenant_id="tenant-other", account_id=decoy.id),
        ]
    )
    session.commit()


class DummyUser:
    def __init__(self, user_id="user-1"):
        self.id = user_id


class DummyFile:
    def __init__(self, filename="test.txt", mimetype="text/plain", content=b"data"):
        self.filename = filename
        self.mimetype = mimetype
        self._content = content
        self.stream = io.BytesIO(content)

    def read(self):
        return self.stream.read()


class RecordingStream(io.BytesIO):
    def __init__(self, content: bytes, events: list[str]):
        super().__init__(content)
        self.events = events

    def read(self, *args, **kwargs):
        self.events.append("file-read")
        return super().read(*args, **kwargs)


class DummyToolFile:
    def __init__(self, name="test.txt", mimetype="text/plain"):
        self.id = "file-id"
        self.name = name
        self.size = 10
        self.mimetype = mimetype
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
        dummy_file = DummyFile(filename="report.docx", mimetype="application/octet-stream")

        module.request = fake_request(
            {
                "timestamp": "123",
                "nonce": "abc",
                "sign": "sig",
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "conversation_id": "conversation-1",
            },
            file=dummy_file,
        )

        tool_file_manager_instance = mock_tool_file_manager.return_value
        tool_file_manager_instance.create_file_by_raw.return_value = DummyToolFile(
            name="report.docx",
            mimetype="application/octet-stream",
        )

        mock_tool_file_manager.sign_file.return_value = "signed-url"

        api = module.PluginUploadFileApi()
        post_fn = unwrap(api.post)

        result, status_code = post_fn(api)

        assert status_code == 201
        assert result["id"] == "file-id"
        assert result["reference"] == build_file_reference(record_id="file-id")
        assert result["preview_url"] == "signed-url"
        assert result["extension"] == ".docx"
        mock_verify_signature.assert_called_once()
        assert mock_verify_signature.call_args.kwargs["conversation_id"] == "conversation-1"
        tool_file_manager_instance.create_file_by_raw.assert_called_once()
        assert tool_file_manager_instance.create_file_by_raw.call_args.kwargs["conversation_id"] == "conversation-1"
        mock_tool_file_manager.sign_file.assert_called_once_with(tool_file_id="file-id", extension=".docx")

    @patch.object(module, "get_user")
    @patch.object(module, "ToolFileManager")
    @pytest.mark.parametrize("sqlite_session", [(Account, TenantAccountJoin)], indirect=True)
    def test_account_upload_preserves_signed_account_owner(
        self,
        mock_tool_file_manager,
        mock_get_user,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        _persist_account_memberships(sqlite_session)
        events: list[str] = []
        dummy_file = DummyFile(filename="report.pdf", mimetype="application/pdf", content=b"account-owned")
        dummy_file.stream = RecordingStream(b"account-owned", events)

        @contextmanager
        def membership_session():
            events.append("membership-session-enter")
            try:
                yield sqlite_session
            finally:
                events.append("membership-session-exit")

        monkeypatch.setattr(module.session_factory, "create_session", membership_session)
        monkeypatch.setattr(
            module,
            "request",
            fake_request(
                {
                    "timestamp": "123",
                    "nonce": "abc",
                    "sign": "sig",
                    "tenant_id": "tenant-1",
                    "user_id": "account-1",
                    "user_from": "account",
                },
                file=dummy_file,
            ),
        )
        tool_file_manager = mock_tool_file_manager.return_value
        tool_file_manager.create_file_by_raw.side_effect = lambda **_kwargs: (
            events.append("storage-create-file") or DummyToolFile(name="report.pdf", mimetype="application/pdf")
        )
        mock_tool_file_manager.sign_file.return_value = "signed-url"

        with patch.object(
            module,
            "verify_plugin_file_signature",
            side_effect=lambda **_kwargs: events.append("signature-verify") or True,
        ) as verify_signature:
            api = module.PluginUploadFileApi()
            result, status_code = unwrap(api.post)(api)

        assert status_code == 201
        assert result["reference"] == build_file_reference(record_id="file-id")
        assert events == [
            "membership-session-enter",
            "membership-session-exit",
            "signature-verify",
            "file-read",
            "storage-create-file",
        ]
        mock_get_user.assert_not_called()
        verify_signature.assert_called_once_with(
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-1",
            user_id="account-1",
            conversation_id=None,
            user_from="account",
            timestamp="123",
            nonce="abc",
            sign="sig",
        )
        tool_file_manager.create_file_by_raw.assert_called_once_with(
            user_id="account-1",
            tenant_id="tenant-1",
            file_binary=b"account-owned",
            mimetype="application/pdf",
            filename="report.pdf",
            conversation_id=None,
        )

    @patch.object(module, "verify_plugin_file_signature")
    @patch.object(module, "get_user")
    @patch.object(module, "ToolFileManager")
    @pytest.mark.parametrize("sqlite_session", [(Account, TenantAccountJoin)], indirect=True)
    def test_account_upload_rejects_owner_outside_tenant(
        self,
        mock_tool_file_manager,
        mock_get_user,
        mock_verify_signature,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        _persist_account_memberships(sqlite_session)
        events: list[str] = []

        @contextmanager
        def membership_session():
            events.append("membership-session-enter")
            try:
                yield sqlite_session
            finally:
                events.append("membership-session-exit")

        monkeypatch.setattr(module.session_factory, "create_session", membership_session)
        monkeypatch.setattr(
            module,
            "request",
            fake_request(
                {
                    "timestamp": "123",
                    "nonce": "abc",
                    "sign": "sig",
                    "tenant_id": "tenant-1",
                    "user_id": "account-outside-tenant",
                    "user_from": "account",
                },
                file=DummyFile(),
            ),
        )

        api = module.PluginUploadFileApi()
        with pytest.raises(Forbidden):
            unwrap(api.post)(api)

        assert events == ["membership-session-enter", "membership-session-exit"]
        mock_get_user.assert_not_called()
        mock_verify_signature.assert_not_called()
        mock_tool_file_manager.assert_not_called()

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
