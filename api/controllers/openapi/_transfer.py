"""The ``/openapi/v1`` side of file transfers: who owns one, where its link points, the per-request slot
for transfer bytes, and how the module's refusals answer on this surface.

A leaf of the transport: ``transfers.py`` and ``_contract.py`` import it, so it imports neither.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from enum import StrEnum
from functools import singledispatch, wraps
from http import HTTPStatus
from io import BytesIO
from typing import Any, Final

from flask import Response, after_this_request, current_app, g, request, url_for
from werkzeug.datastructures import FileStorage
from werkzeug.http import parse_options_header

from configs import dify_config
from constants import BYTES_PER_MIB, HEADER_NAME_FILE_RESULT
from controllers.openapi._errors import (
    DownloadLinkExpired,
    FileTransfersDisabled,
    OpenApiError,
    TransfersBusy,
    UploadAlreadyReceived,
    UploadArchiveInvalid,
    UploadFieldTooLong,
    UploadIsAFolder,
    UploadIsOneFile,
    UploadLinkExpired,
    UploadNotAZip,
    UploadNotFound,
    UploadNotReceived,
    UploadTooLarge,
)
from controllers.openapi._models import FileResultResponse, TransferredFile
from extensions.ext_application_services import application_services
from libs.datetime_utils import to_utc_iso
from libs.oauth_bearer import get_auth_ctx
from services.file_transfer import (
    FileTransferError,
    TransferAlreadyReceivedError,
    TransferArchiveError,
    TransferDirection,
    TransferFile,
    TransferLinkExpiredError,
    TransferNotAZipError,
    TransferNotFoundError,
    TransferNotReceivedError,
    TransferRequestTooLargeError,
    TransferShapeError,
    TransferTextTooLongError,
    TransferTicket,
    TransferTooLargeError,
)


class FileResult(StrEnum):
    """Values of the file-result header: how a file operation answers."""

    TRANSFER = "transfer"


TRANSFER_BYTES_ENDPOINT: Final = "openapi_transfer_bytes"
TOKEN_PARAM: Final = "token"
CONTENT_DISPOSITION_HEADER: Final = "Content-Disposition"
DEFAULT_MIME_TYPE: Final = "application/octet-stream"
_FILENAME_OPTION: Final = "filename"
_SLOT_HELD: Final = "file_transfer_slot_held"
# What this request may still hold of the transfers it loads, in bytes; absent until its first load.
_BYTES_LEFT: Final = "file_transfer_bytes_left"


def require_file_transfers() -> None:
    """Postcondition: returns while file transfers are on; raises ``FileTransfersDisabled`` (503) otherwise."""
    if not dify_config.file_transfers_on:
        raise FileTransfersDisabled()


def transfer_owner_id() -> str:
    """Precondition: inside an admitted request. Postcondition: the caller's owner id, the value
    ``RequestContext.account_id`` carries: the account id, or the token id for SSO and workspace tokens.
    """
    auth = get_auth_ctx()
    return str(auth.account_id or auth.token_id)


def transfer_url(transfer_id: str, token: str) -> str:
    """Precondition: inside a request to this blueprint. Postcondition: the transfer's byte link on the host
    the caller reached, with the token in the query string so request logs that print the path never hold it.
    """
    return url_for(f".{TRANSFER_BYTES_ENDPOINT}", transfer_id=transfer_id, **{TOKEN_PARAM: token}, _external=True)


def hold_slot() -> None:
    """Hold one slot for transfer bytes until the response is closed; later calls in the request do nothing.

    Postcondition: this request holds exactly one slot, or ``TransfersBusy`` was raised and it holds none.
    """
    if g.get(_SLOT_HELD, False):
        return
    transfers = application_services().file_transfers
    if not transfers.take_slot():
        raise TransfersBusy(retry_after_seconds=int(transfers.limits.busy_retry_after.total_seconds()))
    setattr(g, _SLOT_HELD, True)

    @after_this_request
    def free_on_close(response: Response) -> Response:
        response.call_on_close(transfers.free_slot)
        return response


def answers_file_as_transfer(view: Callable[..., Any]) -> Callable[..., Any]:
    """Wrap a file operation so a request with ``X-Dify-File-Result: transfer`` gets its file parked.

    Postcondition: without that header value, the view's result untouched. With it while file transfers are off,
    503 ``FileTransfersDisabled`` and the view does not run. With it otherwise, a result of status 300 or
    above untouched; any other is read whole, its response closed (so its close callbacks run), and the file
    parked for the caller: 200 with ``FileResultResponse``. Holds this request's slot while the bytes are held;
    a file above the transfer limit is refused with that limit.
    """

    @wraps(view)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        if request.headers.get(HEADER_NAME_FILE_RESULT) != FileResult.TRANSFER:
            return view(*args, **kwargs)
        require_file_transfers()
        result = view(*args, **kwargs)
        response = current_app.make_response(result)
        if response.status_code >= HTTPStatus.MULTIPLE_CHOICES:
            return response
        hold_slot()
        response.direct_passthrough = False
        content = response.get_data()
        response.close()
        _, options = parse_options_header(response.headers.get(CONTENT_DISPOSITION_HEADER))
        transfers = application_services().file_transfers
        try:
            ticket = transfers.park(
                transfer_owner_id(),
                name=options.get(_FILENAME_OPTION, ""),
                mime_type=response.mimetype or DEFAULT_MIME_TYPE,
                content=content,
            )
        except FileTransferError as error:
            raise refusal_of(error) from None
        return FileResultResponse(file=_transferred(ticket)), HTTPStatus.OK

    return wrapper


def _transferred(ticket: TransferTicket) -> TransferredFile:
    transfer = ticket.transfer
    file = transfer.file
    assert file is not None, "a parked transfer always holds its file"
    return TransferredFile(
        id=transfer.id,
        name=file.name,
        size=file.size,
        sha256=file.sha256,
        download_url=transfer_url(transfer.id, ticket.token),
        download_before=ticket.link_expires_at,
        expires_at=transfer.expires_at,
    )


def parts_of(transfer_id: str, *, field: str, folder: bool) -> FileStorage | dict[str, FileStorage]:
    """Precondition: inside an admitted request; ``transfer_id`` sat in body field ``field``, at a place that takes
    a folder when ``folder`` is true and one file otherwise.

    Postcondition: the same file parts a multipart request gives: one part for a file, a path-to-part mapping
    in the zip's order for a folder. A transfer of the other shape is refused with 400, naming ``field``, before
    any byte is read. Holds this request's slot before anything is loaded. Every transfer this
    request loads, the same id each time it is loaded, holds bytes against one total of ``limits.max_bytes``;
    a load past it is refused. A refusal names ``field`` and the next step; while file transfers are off, 503
    ``FileTransfersDisabled``.
    """
    require_file_transfers()
    hold_slot()
    transfers = application_services().file_transfers
    bytes_left: int = g.get(_BYTES_LEFT, transfers.limits.max_bytes)
    try:
        loaded = transfers.load(transfer_owner_id(), transfer_id, may_hold=bytes_left, folder=folder)
    except FileTransferError as error:
        raise refusal_of(error, field=field) from None
    setattr(g, _BYTES_LEFT, bytes_left - loaded.held_bytes)
    if loaded.transfer.folder:
        return {file.path: _part(file) for file in loaded.files}
    return _part(loaded.files[0])


def _part(file: TransferFile) -> FileStorage:
    return FileStorage(stream=BytesIO(file.content), filename=file.name, content_type=file.mime_type)


def refusal_of(error: FileTransferError, *, field: str | None = None) -> OpenApiError:
    """Postcondition: the error this surface answers for ``error``. With ``field``, the transfer id sat in
    that body field: the message names the field, and an unknown id is a 400 instead of the byte route's 404.
    """
    refusal = _refusal(error, field)
    if field is not None:
        refusal.description = f"{field}: {refusal.description}"
    return refusal


@singledispatch
def _refusal(error: FileTransferError, field: str | None) -> OpenApiError:
    raise TypeError(f"no refusal for {type(error).__name__}")


@_refusal.register
def _(error: TransferNotFoundError, field: str | None) -> OpenApiError:
    status = HTTPStatus.NOT_FOUND if field is None else HTTPStatus.BAD_REQUEST
    return UploadNotFound(
        f"No upload {error.transfer_id} for this login. It is unknown, expired, or was dropped to make room. "
        "Prepare and send again.",
        status_code=status,
    )


@_refusal.register
def _(error: TransferNotReceivedError, field: str | None) -> OpenApiError:
    return UploadNotReceived(
        f"Upload {error.transfer_id} was prepared but no file reached this server. The shell may be sandboxed "
        f"or blocked from this host. Send it again before {to_utc_iso(error.upload_before)}, or prepare again."
    )


@_refusal.register
def _(error: TransferLinkExpiredError, field: str | None) -> OpenApiError:
    return _LINK_EXPIRED[error.direction]()


@_refusal.register
def _(error: TransferAlreadyReceivedError, field: str | None) -> OpenApiError:
    return UploadAlreadyReceived()


@_refusal.register
def _(error: TransferTooLargeError, field: str | None) -> OpenApiError:
    return UploadTooLarge(f"The file is larger than this server's limit of {error.limit / BYTES_PER_MIB:g} MiB.")


@_refusal.register
def _(error: TransferRequestTooLargeError, field: str | None) -> OpenApiError:
    return UploadTooLarge(
        f"The files of this request together are above this server's limit of {error.limit / BYTES_PER_MIB:g} MiB. "
        "Send fewer or smaller files in one request."
    )


@_refusal.register
def _(error: TransferTextTooLongError, field: str | None) -> OpenApiError:
    return UploadFieldTooLong(
        f"The {error.text.label} is longer than {error.limit} characters. Send the file under a shorter one."
    )


@_refusal.register
def _(error: TransferNotAZipError, field: str | None) -> OpenApiError:
    return UploadNotAZip()


# Keyed by whether the transfer that did not fit is a folder.
_SHAPE_REFUSALS: Final[Mapping[bool, type[OpenApiError]]] = {True: UploadIsAFolder, False: UploadIsOneFile}


@_refusal.register
def _(error: TransferShapeError, field: str | None) -> OpenApiError:
    return _SHAPE_REFUSALS[error.folder]()


@_refusal.register
def _(error: TransferArchiveError, field: str | None) -> OpenApiError:
    return UploadArchiveInvalid(f"The folder's zip cannot be unpacked: {error.archive_error}.")


_LINK_EXPIRED: Final[dict[TransferDirection, type[OpenApiError]]] = {
    TransferDirection.IN: UploadLinkExpired,
    TransferDirection.OUT: DownloadLinkExpired,
}
