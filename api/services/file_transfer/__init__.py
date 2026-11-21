"""File transfers: one file parked on the server for a short time, owned by the caller.

A transfer goes in (``prepare``, then ``receive`` with the token) or out (``park``, then ``download`` with the
token); ``open_for_upload`` and ``open_for_download`` check a token without touching any bytes. Its owner uses it
by id with ``load`` until it expires, any number of times. A folder travels as one zip of its contents and comes
back from ``load`` as the zip's members. ``purge_expired`` deletes what expired, and
``take_slot``/``free_slot`` bound the requests of one process that hold transfer bytes.

Every refusal is a ``FileTransferError`` subtype. An owner is an opaque string. The module builds no URL,
knows no HTTP, login, workspace or operation, and reads no configuration: its host passes ``TransferLimits``.
"""

from services.file_transfer.contracts import (
    FileTransferError,
    IncomingFile,
    LoadedTransfer,
    StoredFile,
    StoredText,
    Transfer,
    TransferAlreadyReceivedError,
    TransferArchiveError,
    TransferBlobs,
    TransferDirection,
    TransferFile,
    TransferLimits,
    TransferLinkExpiredError,
    TransferNotAZipError,
    TransferNotFoundError,
    TransferNotReceivedError,
    TransferRepository,
    TransferTextTooLongError,
    TransferTicket,
    TransferTooLargeError,
)
from services.file_transfer.service import FileTransferService

__all__ = [
    "FileTransferError",
    "FileTransferService",
    "IncomingFile",
    "LoadedTransfer",
    "StoredFile",
    "StoredText",
    "Transfer",
    "TransferAlreadyReceivedError",
    "TransferArchiveError",
    "TransferBlobs",
    "TransferDirection",
    "TransferFile",
    "TransferLimits",
    "TransferLinkExpiredError",
    "TransferNotAZipError",
    "TransferNotFoundError",
    "TransferNotReceivedError",
    "TransferRepository",
    "TransferTextTooLongError",
    "TransferTicket",
    "TransferTooLargeError",
]
