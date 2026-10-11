import pytest
from flask import Flask
from flask.typing import ResponseReturnValue
from flask_restx import Api, Resource
from werkzeug.exceptions import Forbidden

from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileAccessDeniedError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileUnavailableError,
    RemoteFileUploadError,
    RemoteFileUrlBlockedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console import api as console_api
from controllers.service_api import api as service_api
from libs.exception import BaseHTTPException
from libs.external_api import ExternalApi
from services.errors.base import NoPermissionError
from services.errors.workspace import WorkspaceApplicationError


@pytest.mark.parametrize("source_api", [console_api, service_api], ids=["console", "service_api"])
@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (NoPermissionError("Access denied"), 400, "invalid_param", "Access denied"),
        (ValueError("Invalid input"), 400, "invalid_param", "Invalid input"),
        (Forbidden("Access denied"), 403, "forbidden", "Access denied"),
        (WorkspaceApplicationError("unmapped workspace failure"), 500, "unknown", "Internal Server Error"),
        (RuntimeError("backend detail"), 500, "unknown", "Internal Server Error"),
    ],
)
def test_surface_permission_error_mapping_preserves_other_responses(
    source_api: Api, error: Exception, status: int, code: str, message: str
) -> None:
    app = Flask(__name__)
    api = Api(app, doc=False)
    # Use production registration and ordering; do not mutate the shared API instance.
    api.error_handlers = source_api.error_handlers.copy()

    class Endpoint(Resource):
        def get(self) -> ResponseReturnValue:
            raise error

    api.add_resource(Endpoint, "/error")
    response = app.test_client().get("/error")
    assert response.status_code == status
    assert response.json == {"code": code, "message": message, "status": status}


def test_permission_error_mapping_is_not_registered_on_generic_apis() -> None:
    app = Flask(__name__)
    api = ExternalApi(app)

    class Endpoint(Resource):
        def get(self) -> ResponseReturnValue:
            raise NoPermissionError("internal permission detail")

    api.add_resource(Endpoint, "/error")
    response = app.test_client().get("/error")
    assert response.status_code == 500
    assert response.json == {"code": "unknown", "message": "Internal Server Error", "status": 500}


class TestFilenameNotExistsError:
    def test_defaults(self):
        error = FilenameNotExistsError()

        assert error.code == 400
        assert error.error_code == "filename_not_exists_error"
        assert error.description == "The specified filename does not exist."
        assert error.data == {
            "code": "filename_not_exists_error",
            "message": "The specified filename does not exist.",
            "status": 400,
        }


class TestRemoteFileUploadError:
    def test_defaults(self):
        error = RemoteFileUploadError()

        assert error.code == 400
        assert error.error_code == "remote_file_upload_error"
        assert error.description == "Error uploading remote file."
        assert error.data == {
            "code": "remote_file_upload_error",
            "message": "Error uploading remote file.",
            "status": 400,
        }


@pytest.mark.parametrize(
    ("error_type", "error_code", "description", "status"),
    [
        (RemoteFileInvalidUrlError, "remote_file_invalid_url", "The remote file URL is invalid.", 400),
        (RemoteFileUrlBlockedError, "remote_file_url_blocked", "The remote file URL is not allowed.", 400),
        (RemoteFileNotFoundError, "remote_file_not_found", "The remote file could not be found.", 404),
        (
            RemoteFileAccessDeniedError,
            "remote_file_access_denied",
            "The remote file cannot be accessed without authorization.",
            400,
        ),
        (
            RemoteFileUnavailableError,
            "remote_file_unavailable",
            "The remote file is temporarily unavailable.",
            502,
        ),
        (
            RemoteFileInvalidResponseError,
            "remote_file_invalid_response",
            "The remote file server returned an invalid response.",
            502,
        ),
    ],
)
def test_remote_file_errors(
    error_type: type[BaseHTTPException],
    error_code: str,
    description: str,
    status: int,
) -> None:
    error = error_type()

    assert error.code == status
    assert error.error_code == error_code
    assert error.description == description
    assert error.data == {"code": error_code, "message": description, "status": status}


class TestFileTooLargeError:
    def test_defaults(self):
        error = FileTooLargeError()

        assert error.code == 413
        assert error.error_code == "file_too_large"
        assert error.description == "File size exceeded. {message}"


class TestUnsupportedFileTypeError:
    def test_defaults(self):
        error = UnsupportedFileTypeError()

        assert error.code == 415
        assert error.error_code == "unsupported_file_type"
        assert error.description == "File type not allowed."


class TestBlockedFileExtensionError:
    def test_defaults(self):
        error = BlockedFileExtensionError()

        assert error.code == 400
        assert error.error_code == "file_extension_blocked"
        assert error.description == "The file extension is blocked for security reasons."


class TestTooManyFilesError:
    def test_defaults(self):
        error = TooManyFilesError()

        assert error.code == 400
        assert error.error_code == "too_many_files"
        assert error.description == "Only one file is allowed."


class TestNoFileUploadedError:
    def test_defaults(self):
        error = NoFileUploadedError()

        assert error.code == 400
        assert error.error_code == "no_file_uploaded"
        assert error.description == "Please upload your file."
