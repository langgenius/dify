"""The ``/openapi/v1`` side of file transfers: who owns one, where its link points, the per-request slot
for transfer bytes, and how the module's refusals answer on this surface.

A leaf of the transport: ``transfers.py`` and ``_contract.py`` import it, so it imports neither.
"""

from __future__ import annotations

from functools import singledispatch
from http import HTTPStatus
from typing import Final

from flask import Response, after_this_request, g, url_for

from constants import BYTES_PER_MIB
from controllers.openapi._errors import (
    DownloadLinkExpired,
    OpenApiError,
    TransfersBusy,
    UploadAlreadyReceived,
    UploadArchiveInvalid,
    UploadLinkExpired,
    UploadNotAZip,
    UploadNotFound,
    UploadNotReceived,
    UploadTooLarge,
)
from extensions.ext_application_services import application_services
from libs.oauth_bearer import get_auth_ctx
from services.file_transfer import (
    FileTransferError,
    TransferAlreadyReceivedError,
    TransferArchiveError,
    TransferDirection,
    TransferLinkExpiredError,
    TransferNotAZipError,
    TransferNotFoundError,
    TransferNotReceivedError,
    TransferTooLargeError,
)

TRANSFER_BYTES_ENDPOINT: Final = "openapi_transfer_bytes"
TOKEN_PARAM: Final = "token"
_SLOT_HELD: Final = "file_transfer_slot_held"


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
        f"or blocked from this host. Send it again before {error.upload_before.isoformat()}, or prepare again."
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
def _(error: TransferNotAZipError, field: str | None) -> OpenApiError:
    return UploadNotAZip()


@_refusal.register
def _(error: TransferArchiveError, field: str | None) -> OpenApiError:
    return UploadArchiveInvalid(f"The folder's zip cannot be unpacked: {error.archive_error}.")


_LINK_EXPIRED: Final[dict[TransferDirection, type[OpenApiError]]] = {
    TransferDirection.IN: UploadLinkExpired,
    TransferDirection.OUT: DownloadLinkExpired,
}
