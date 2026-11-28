"""File transfers: one file parked on the server for a short time, owned by the caller.

A transfer goes in (``prepare``, then ``receive`` with the token) or out (``park``, then ``download`` with the
token); ``open_for_upload`` and ``open_for_download`` check a token without touching any bytes. Its owner uses it
by id with ``load`` until it expires, any number of times. A folder travels as one zip of its contents and comes
back from ``load`` as the zip's members. ``purge_expired`` deletes what expired, ``sweep_orphans`` deletes stored
bytes left without a row, and
``take_slot``/``free_slot`` bound the requests of one process that hold transfer bytes.

Every refusal is a ``FileTransferError`` subtype. An owner is an opaque string. The module builds no URL,
knows no HTTP, login, workspace or operation, and reads no configuration: its host passes ``TransferLimits``.
"""

from services.file_transfer.contracts import (
    BUSY_RETRY_AFTER,
    DOWNLOAD_LINK_LIFE,
    MAX_UNPACKED_FILES,
    UPLOAD_LINK_LIFE,
    FileTransferError,
    IncomingFile,
    LoadedTransfer,
    PurgeResult,
    StoredFile,
    StoredText,
    Transfer,
    TransferAlreadyReceivedError,
    TransferArchiveError,
    TransferDirection,
    TransferFile,
    TransferLimits,
    TransferLinkExpiredError,
    TransferNotAZipError,
    TransferNotFoundError,
    TransferNotReceivedError,
    TransferRepository,
    TransferRequestTooLargeError,
    TransferShapeError,
    TransferTextTooLongError,
    TransferTicket,
    TransferTooLargeError,
)
from services.file_transfer.service import FileTransferService

__all__ = [
    "BUSY_RETRY_AFTER",
    "DOWNLOAD_LINK_LIFE",
    "MAX_UNPACKED_FILES",
    "UPLOAD_LINK_LIFE",
    "FileTransferError",
    "FileTransferService",
    "IncomingFile",
    "LoadedTransfer",
    "PurgeResult",
    "StoredFile",
    "StoredText",
    "Transfer",
    "TransferAlreadyReceivedError",
    "TransferArchiveError",
    "TransferDirection",
    "TransferFile",
    "TransferLimits",
    "TransferLinkExpiredError",
    "TransferNotAZipError",
    "TransferNotFoundError",
    "TransferNotReceivedError",
    "TransferRepository",
    "TransferRequestTooLargeError",
    "TransferShapeError",
    "TransferTextTooLongError",
    "TransferTicket",
    "TransferTooLargeError",
]
