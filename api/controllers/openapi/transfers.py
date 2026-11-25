"""File transfers on /openapi/v1: ``prepare.upload``, and the byte route that takes one upload or gives one download.

The byte route is not an operation: it has no ``@endpoint``, no login and is not in the catalog. The token in its
query string proves the right to one transfer, and is checked before any byte of the request body is read.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Final
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource
from werkzeug.exceptions import RequestEntityTooLarge

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, multipart_header_allowance
from controllers.openapi._errors import OpenApiError, UploadNotOneFile
from controllers.openapi._models import UploadCommands, UploadPrepared, UploadPreparePayload, UploadReceived
from controllers.openapi._transfer import (
    CONTENT_DISPOSITION_HEADER,
    DEFAULT_MIME_TYPE,
    TOKEN_PARAM,
    TRANSFER_BYTES_ENDPOINT,
    hold_slot,
    refusal_of,
    require_file_transfers,
    transfer_owner_id,
    transfer_url,
)
from controllers.openapi.auth.requirements import CheckFileTransfersEnabled, CheckSubject
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, ResourceAccessSubject
from extensions.ext_application_services import application_services
from services.file_transfer import FileTransferError, IncomingFile, StoredFile, Transfer, TransferTooLargeError

logger = logging.getLogger(__name__)

PREPARE_UPLOAD_OP: Final = "prepare.upload"
UPLOAD_EVENT: Final = "file_transfer.upload"
DOWNLOAD_EVENT: Final = "file_transfer.download"
_ONE_PART: Final = 1

# Keyed by whether the upload is a folder, as _UPLOAD_COMMANDS is.
NEXT_STEPS: Final[Mapping[bool, str]] = {
    False: 'Put this id in a file field of the operation you call next, such as "files": {"<variable name>": "<id>"}.',
    True: 'Put this id where a folder goes: as the whole of a field that takes one, such as "files": "<id>".',
}

# One template per (folder, shell); {url} is the upload link. Without curl's -f, a refusal's body is shown. The sh
# folder command streams the zip into curl, so no zip file is left behind or appended to by a later upload.
_UPLOAD_COMMANDS: Final[Mapping[bool, UploadCommands]] = {
    False: UploadCommands(
        sh='curl -sS -F "file=@<path to the file>" "{url}"',
        powershell='curl.exe -sS -F "file=@<path to the file>" "{url}"',
    ),
    True: UploadCommands(
        sh='(cd "<folder>" && zip -r -q - .) | curl -sS -F "file=@-;filename=upload.zip" "{url}"',
        powershell='Compress-Archive -Path "<folder>\\*" -DestinationPath upload.zip -Force; '
        'curl.exe -sS -F "file=@upload.zip" "{url}"',
    ),
}


def _upload_commands(*, folder: bool, url: str) -> UploadCommands:
    """Postcondition: the commands that send this upload from each shell, the link filled in."""
    templates = _UPLOAD_COMMANDS[folder]
    return UploadCommands(sh=templates.sh.format(url=url), powershell=templates.powershell.format(url=url))


@openapi_ns.route("/transfers")
class UploadPrepareApi(Resource):
    @endpoint(
        op=PREPARE_UPLOAD_OP,
        kind=Kind.OBJECT,
        summary="Get a place to send a local file or a zipped folder, and an id to use in a file field",
        examples=(
            Example(title="Prepare to send one file", input={}),
            Example(title="Prepare to send a folder as one zip", input={"folder": True}),
        ),
        pat_policy=PersonalAccessTokenPolicy.IDENTITY_DISCOVERY,
        requirements=(
            CheckFileTransfersEnabled(),
            CheckSubject(allowed=(AccountSubject, ExternalSsoSubject, ResourceAccessSubject)),
        ),
        body=UploadPreparePayload,
        returns=(HTTPStatus.CREATED, UploadPrepared, "Upload prepared"),
        context=None,
    )
    def post(self, *, body: UploadPreparePayload):
        """Precondition: an admitted caller. Postcondition: 201 with a new incoming transfer the caller owns,
        its upload link and commands. Nothing is stored until a file is sent to the link. 503 while file
        transfers are off, checked before any other guard.
        """
        transfers = application_services().file_transfers
        ticket = transfers.prepare(transfer_owner_id(), folder=body.folder)
        url = transfer_url(ticket.transfer.id, ticket.token)
        return UploadPrepared(
            id=ticket.transfer.id,
            upload_url=url,
            upload_commands=_upload_commands(folder=body.folder, url=url),
            upload_before=ticket.link_expires_at,
            expires_at=ticket.transfer.expires_at,
            max_bytes=transfers.limits.max_bytes,
        )


@openapi_ns.route("/transfers/<string:transfer_id>", endpoint=TRANSFER_BYTES_ENDPOINT)
class TransferBytesApi(Resource):
    """One transfer's bytes: POST sends the file of a prepared upload, GET fetches a parked file."""

    def post(self, transfer_id: str):
        """Precondition: ``token`` in the query string. Postcondition: 200 with the received file's facts and
        the next step; the token is checked before the body is read. Refusals: 404 unknown or wrong token,
        410 link expired, 409 different bytes already received, 413 too large, 400 not one file part or a
        folder upload that is not a zip, 429 when every slot is taken, 503 while file transfers are off.
        """
        require_file_transfers()
        transfers = application_services().file_transfers
        token = request.args.get(TOKEN_PARAM, "")
        try:
            transfers.open_for_upload(transfer_id, token)
        except FileTransferError as error:
            raise refusal_of(error) from None
        hold_slot()
        request.max_content_length = transfers.limits.max_bytes + multipart_header_allowance(_ONE_PART)
        request.max_form_parts = _ONE_PART
        incoming = _one_file()
        try:
            transfer = transfers.receive(transfer_id, token, incoming)
        except FileTransferError as error:
            raise refusal_of(error) from None
        file = transfer.file
        assert file is not None, "receive returns the transfer holding its file"
        _log(UPLOAD_EVENT, transfer, file)
        return UploadReceived(
            id=transfer.id,
            name=file.name,
            size=file.size,
            sha256=file.sha256,
            expires_at=transfer.expires_at,
            next=NEXT_STEPS[transfer.folder],
        ).model_dump(mode="json"), HTTPStatus.OK

    def get(self, transfer_id: str):
        """Precondition: ``token`` in the query string. Postcondition: 200 with the parked file as an attachment,
        streamed from storage with its stored size as ``Content-Length``, while its download link works; the token
        is checked before a slot is taken, and the slot is held until the response closes. Refusals: 404 unknown,
        wrong token or an upload, 410 link expired, 429 when every slot is taken, 503 while file transfers are off.
        """
        require_file_transfers()
        transfers = application_services().file_transfers
        token = request.args.get(TOKEN_PARAM, "")
        try:
            transfers.open_for_download(transfer_id, token)
        except FileTransferError as error:
            raise refusal_of(error) from None
        hold_slot()
        try:
            transfer, chunks = transfers.download(transfer_id, token)
        except FileTransferError as error:
            raise refusal_of(error) from None
        file = transfer.file
        assert file is not None, "an outgoing transfer always holds its file"
        _log(DOWNLOAD_EVENT, transfer, file)
        return Response(
            chunks,
            mimetype=DEFAULT_MIME_TYPE,
            headers={
                CONTENT_DISPOSITION_HEADER: f"attachment; filename*=UTF-8''{quote(file.name)}",
                "Content-Length": str(file.size),
                "X-Content-Type-Options": "nosniff",
            },
        )


def _one_file() -> IncomingFile:
    """Postcondition: the request's one file part, read whole. Raises 413 for a body above the route's cap
    and 400 for no file part, a part without a file name, or any second part.
    """
    try:
        parts = request.files
        fields = request.form
    except RequestEntityTooLarge:
        raise _over_cap() from None
    if fields:
        raise UploadNotOneFile()
    if len(parts) != _ONE_PART:
        raise UploadNotOneFile()
    part = next(iter(parts.values()))
    if not part.filename:
        raise UploadNotOneFile()
    return IncomingFile(
        name=part.filename,
        mime_type=part.mimetype or DEFAULT_MIME_TYPE,
        content=part.stream.read(),
    )


def _over_cap() -> OpenApiError:
    """Postcondition: a body over the byte cap, or of unknown length, is too large; a body under it was
    refused for its number of parts.
    """
    too_large = refusal_of(TransferTooLargeError(limit=application_services().file_transfers.limits.max_bytes))
    length = request.content_length
    limit = request.max_content_length
    if length is None:
        return too_large
    if limit is None:
        return too_large
    if length > limit:
        return too_large
    return UploadNotOneFile()


def _log(event: str, transfer: Transfer, file: StoredFile) -> None:
    """Postcondition: one log line for the transfer; it never holds the token or the query string."""
    logger.info(
        event,
        extra={
            "event": event,
            "transfer_id": transfer.id,
            "owner_id": transfer.owner_id,
            "size": file.size,
            "client_address": request.remote_addr,
        },
    )
