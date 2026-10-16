import io
import types
from collections.abc import Callable
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

import controllers.files.plugin_file_upload as module
from controllers.files import bp as files_blueprint
from core.workflow.file_reference import build_file_reference
from enums import DeploymentEdition
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError
from services.plugin_file_upload_service import PluginFileUploadAccessDeniedError, PluginFileUploadResult


class DummyFile:
    def __init__(
        self,
        *,
        filename: str | None = "report.pdf",
        mimetype: str | None = "application/pdf",
        content: bytes = b"content",
    ) -> None:
        self.filename = filename
        self.mimetype = mimetype
        self.stream = io.BytesIO(content)


def _fake_request(args: dict[str, object], *, file: DummyFile | None = None) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        args=types.SimpleNamespace(to_dict=lambda **_kwargs: args),
        files={"file": file} if file is not None else {},
    )


def _result() -> PluginFileUploadResult:
    return PluginFileUploadResult(
        id="file-id",
        reference=build_file_reference(record_id="file-id"),
        name="report.pdf",
        size=7,
        extension=".pdf",
        mime_type="application/pdf",
        preview_url="https://files.example.com/files/tools/file-id.pdf?signed",
        source_url=None,
        original_url=None,
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_key="tools/tenant-id/file.pdf",
    )


def _valid_args() -> dict[str, object]:
    return {
        "timestamp": "123",
        "nonce": "nonce",
        "sign": "signature",
        "tenant_id": "tenant-id",
        "user_id": "user-id",
        "user_from": "end-user",
        "conversation_id": "conversation-id",
        "max_size": "1024",
    }


@pytest.fixture
def files_app(config_overrides: Callable[..., None]) -> Flask:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(files_blueprint)
    return app


class TestPluginUploadFileApi:
    def test_upload_query_requires_the_signed_user_id(self) -> None:
        args = _valid_args()
        del args["user_id"]

        with pytest.raises(ValidationError):
            module.PluginUploadQuery.model_validate(args)

    @patch.object(module, "application_services")
    def test_upload_returns_the_existing_plugin_file_contract(
        self,
        application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = DummyFile()
        monkeypatch.setattr(module, "request", _fake_request(_valid_args(), file=file))
        service = application_services.return_value.plugin_file_uploads
        service.upload.return_value = _result()

        response, status = unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

        assert status == 201
        assert response == {
            "id": "file-id",
            "reference": build_file_reference(record_id="file-id"),
            "name": "report.pdf",
            "size": 7,
            "extension": ".pdf",
            "mime_type": "application/pdf",
            "created_by": None,
            "created_at": None,
            "preview_url": "https://files.example.com/files/tools/file-id.pdf?signed",
            "source_url": None,
            "original_url": None,
            "user_id": "user-id",
            "tenant_id": "tenant-id",
            "conversation_id": "conversation-id",
            "file_key": "tools/tenant-id/file.pdf",
        }
        service.upload.assert_called_once_with(
            stream=file.stream,
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-id",
            user_id="user-id",
            user_from="end-user",
            conversation_id="conversation-id",
            timestamp="123",
            nonce="nonce",
            sign="signature",
            max_size=1024,
        )

    def test_missing_file_has_a_specific_client_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(module, "request", _fake_request(_valid_args()))

        with pytest.raises(module.NoFileUploadedError):
            unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

    @pytest.mark.parametrize(
        ("file", "expected_error"),
        [
            pytest.param(DummyFile(filename=""), module.FilenameNotExistsError, id="filename"),
            pytest.param(DummyFile(mimetype=""), module.UnsupportedFileTypeError, id="mimetype"),
        ],
    )
    def test_invalid_file_metadata_has_a_specific_client_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        file: DummyFile,
        expected_error: type[Exception],
    ) -> None:
        monkeypatch.setattr(module, "request", _fake_request(_valid_args(), file=file))

        with pytest.raises(expected_error):
            unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

    @patch.object(module, "application_services")
    def test_access_denied_is_reported_without_leaking_identity_details(
        self,
        application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(module, "request", _fake_request(_valid_args(), file=DummyFile()))
        application_services.return_value.plugin_file_uploads.upload.side_effect = PluginFileUploadAccessDeniedError()

        with pytest.raises(module.InvalidPluginFileUploadError) as error_info:
            unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

        assert error_info.value.code == 403
        assert error_info.value.error_code == "invalid_plugin_file_upload"

    @patch.object(module, "application_services")
    def test_signed_size_limit_is_reported_as_413(
        self,
        application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(module, "request", _fake_request(_valid_args(), file=DummyFile()))
        application_services.return_value.plugin_file_uploads.upload.side_effect = ServiceFileTooLargeError(
            "signed limit exceeded"
        )

        with pytest.raises(module.FileTooLargeError) as error_info:
            unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

        assert error_info.value.code == 413
        assert error_info.value.__cause__ is not None

    @patch.object(module, "application_services")
    def test_unsupported_file_type_is_reported_as_415(
        self,
        application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(module, "request", _fake_request(_valid_args(), file=DummyFile()))
        application_services.return_value.plugin_file_uploads.upload.side_effect = ServiceUnsupportedFileTypeError()

        with pytest.raises(module.UnsupportedFileTypeError) as error_info:
            unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

        assert error_info.value.code == 415
        assert error_info.value.__cause__ is not None

    @patch.object(module, "application_services")
    def test_unexpected_failure_is_not_relabelled_as_a_client_error(
        self,
        application_services: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        storage_error = OSError("storage unavailable")
        monkeypatch.setattr(module, "request", _fake_request(_valid_args(), file=DummyFile()))
        application_services.return_value.plugin_file_uploads.upload.side_effect = storage_error

        with pytest.raises(OSError) as error_info:
            unwrap(module.PluginUploadFileApi().post)(module.PluginUploadFileApi())

        assert error_info.value is storage_error


class TestPluginUploadFileHttpContract:
    @patch.object(module, "application_services")
    def test_multipart_upload_returns_strict_201_and_consumer_fields(
        self,
        application_services: MagicMock,
        files_app: Flask,
    ) -> None:
        application_services.return_value.plugin_file_uploads.upload.return_value = _result()

        response = files_app.test_client().post(
            "/files/upload/for-plugin",
            query_string=_valid_args(),
            data={"file": (io.BytesIO(b"content"), "report.pdf")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 201
        assert response.get_json() == {
            "id": "file-id",
            "reference": build_file_reference(record_id="file-id"),
            "name": "report.pdf",
            "size": 7,
            "extension": ".pdf",
            "mime_type": "application/pdf",
            "created_by": None,
            "created_at": None,
            "preview_url": "https://files.example.com/files/tools/file-id.pdf?signed",
            "source_url": None,
            "original_url": None,
            "user_id": "user-id",
            "tenant_id": "tenant-id",
            "conversation_id": "conversation-id",
            "file_key": "tools/tenant-id/file.pdf",
        }

    @patch.object(module, "application_services")
    def test_invalid_signature_returns_a_structured_403(
        self,
        application_services: MagicMock,
        files_app: Flask,
    ) -> None:
        application_services.return_value.plugin_file_uploads.upload.side_effect = PluginFileUploadAccessDeniedError()

        response = files_app.test_client().post(
            "/files/upload/for-plugin",
            query_string=_valid_args(),
            data={"file": (io.BytesIO(b"content"), "report.pdf")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 403
        assert response.get_json() == {
            "code": "invalid_plugin_file_upload",
            "message": "The plugin file upload request is invalid or expired.",
            "status": 403,
        }

    @patch.object(module, "application_services")
    def test_signed_size_limit_returns_a_structured_413(
        self,
        application_services: MagicMock,
        files_app: Flask,
    ) -> None:
        application_services.return_value.plugin_file_uploads.upload.side_effect = ServiceFileTooLargeError(
            "signed limit exceeded"
        )

        response = files_app.test_client().post(
            "/files/upload/for-plugin",
            query_string=_valid_args(),
            data={"file": (io.BytesIO(b"content"), "report.pdf")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 413
        assert response.get_json() == {
            "code": "file_too_large",
            "message": "signed limit exceeded",
            "status": 413,
        }

    def test_missing_signed_user_id_returns_400_before_service_call(self, files_app: Flask) -> None:
        query = _valid_args()
        del query["user_id"]

        with patch.object(module, "application_services") as application_services:
            response = files_app.test_client().post(
                "/files/upload/for-plugin",
                query_string=query,
                data={"file": (io.BytesIO(b"content"), "report.pdf")},
                content_type="multipart/form-data",
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_param"
        application_services.assert_not_called()

    def test_missing_file_returns_a_structured_400(self, files_app: Flask) -> None:
        with patch.object(module, "application_services") as application_services:
            response = files_app.test_client().post(
                "/files/upload/for-plugin",
                query_string=_valid_args(),
                data={},
                content_type="multipart/form-data",
            )

        assert response.status_code == 400
        assert response.get_json() == {
            "code": "no_file_uploaded",
            "message": "Please upload your file.",
            "status": 400,
        }
        application_services.assert_not_called()
