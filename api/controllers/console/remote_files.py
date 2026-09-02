from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

import services
from controllers.common import helpers
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    RemoteFileAccessDeniedError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileUnavailableError,
    RemoteFileUrlBlockedError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import JsonResponseWithStatus, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import model_validate, with_current_user
from extensions.ext_application_services import application_services
from fields.file_fields import FileWithSignedUrl, RemoteFileInfo
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from services.remote_file_service import (
    RemoteFileAccessDeniedError as RemoteFileAccessDeniedServiceError,
)
from services.remote_file_service import (
    RemoteFileInvalidResponseError as RemoteFileInvalidResponseServiceError,
)
from services.remote_file_service import RemoteFileInvalidUrlError as RemoteFileInvalidUrlServiceError
from services.remote_file_service import RemoteFileNotFoundError as RemoteFileNotFoundServiceError
from services.remote_file_service import RemoteFileUnavailableError as RemoteFileUnavailableServiceError
from services.remote_file_service import RemoteFileUploadResult
from services.remote_file_service import RemoteFileUrlBlockedError as RemoteFileUrlBlockedServiceError


class RemoteFileUploadPayload(BaseModel):
    url: str = Field(description="URL to fetch", json_schema_extra={"format": "uri"})


register_schema_models(console_ns, RemoteFileUploadPayload)
register_response_schema_models(console_ns, FileWithSignedUrl, RemoteFileInfo)


@console_ns.route("/remote-files/<path:url>")
class GetRemoteFileInfo(Resource):
    @console_ns.doc(
        responses={
            400: "Invalid, blocked, or inaccessible remote file URL",
            404: "Remote file not found",
            502: "Remote file unavailable or returned an invalid response",
            500: "Internal server error",
        }
    )
    @console_ns.response(200, "Success", console_ns.models[RemoteFileInfo.__name__])
    @login_required
    def get(self, url: str):
        decoded_url = helpers.decode_remote_url(url, request.query_string)
        try:
            file_info = application_services().remote_files.fetch_info(url=decoded_url)
        except RemoteFileInvalidUrlServiceError as error:
            raise RemoteFileInvalidUrlError from error
        except RemoteFileUrlBlockedServiceError as error:
            raise RemoteFileUrlBlockedError from error
        except RemoteFileNotFoundServiceError as error:
            raise RemoteFileNotFoundError from error
        except RemoteFileAccessDeniedServiceError as error:
            raise RemoteFileAccessDeniedError from error
        except RemoteFileUnavailableServiceError as error:
            raise RemoteFileUnavailableError from error
        except RemoteFileInvalidResponseServiceError as error:
            raise RemoteFileInvalidResponseError from error

        return dump_response(
            RemoteFileInfo,
            {
                "file_type": file_info.content_type,
                "file_length": file_info.content_length if file_info.content_length is not None else 0,
            },
        )


def upload_remote_file(
    *,
    url: str,
    current_user: Account,
    resource_tenant_id: str | None = None,
) -> RemoteFileUploadResult:
    """Fetch a remote file and persist it under the requested tenant."""
    try:
        return application_services().remote_files.upload_from_url(
            url=url,
            user=current_user,
            tenant_id=resource_tenant_id,
        )
    except RemoteFileInvalidUrlServiceError as error:
        raise RemoteFileInvalidUrlError from error
    except RemoteFileUrlBlockedServiceError as error:
        raise RemoteFileUrlBlockedError from error
    except RemoteFileNotFoundServiceError as error:
        raise RemoteFileNotFoundError from error
    except RemoteFileAccessDeniedServiceError as error:
        raise RemoteFileAccessDeniedError from error
    except RemoteFileUnavailableServiceError as error:
        raise RemoteFileUnavailableError from error
    except RemoteFileInvalidResponseServiceError as error:
        raise RemoteFileInvalidResponseError from error
    except services.errors.file.FileTooLargeError as error:
        raise FileTooLargeError(error.description or "File size exceeded.") from error
    except services.errors.file.UnsupportedFileTypeError as error:
        raise UnsupportedFileTypeError from error
    except services.errors.file.BlockedFileExtensionError as error:
        raise BlockedFileExtensionError(error.description) from error


@console_ns.route("/remote-files/upload")
class RemoteFileUpload(Resource):
    @console_ns.doc(
        responses={
            400: "Invalid, blocked, or inaccessible remote file URL",
            404: "Remote file not found",
            413: "File too large",
            415: "Unsupported file type",
            422: "Request payload validation failed",
            502: "Remote file unavailable or returned an invalid response",
            500: "Internal server error",
        }
    )
    @console_ns.expect(console_ns.models[RemoteFileUploadPayload.__name__])
    @console_ns.response(201, "File uploaded successfully", console_ns.models[FileWithSignedUrl.__name__])
    @login_required
    @with_current_user
    @model_validate(RemoteFileUploadPayload)
    def post(self, payload: RemoteFileUploadPayload, current_user: Account) -> JsonResponseWithStatus:
        remote_file = upload_remote_file(
            url=payload.url,
            current_user=current_user,
        )
        return dump_response(FileWithSignedUrl, remote_file), 201
