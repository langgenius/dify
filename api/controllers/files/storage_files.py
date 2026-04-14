"""Token-based file proxy controller for storage operations.

This controller handles file download and upload operations using opaque UUID tokens.
The token maps to the real storage key in Redis, so the actual storage path is never
exposed in the URL.

Routes:
    GET  /files/storage-files/{token} - Download a file
    PUT  /files/storage-files/{token} - Upload a file

The operation type (download/upload) is determined by the ticket stored in Redis,
not by the HTTP method. This ensures a download ticket cannot be used for upload
and vice versa.
"""

from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource
from werkzeug.exceptions import Forbidden, NotFound, RequestEntityTooLarge

from controllers.files import files_ns
from extensions.ext_storage import storage
from services.storage_ticket_service import StorageTicketService


@files_ns.route("/storage-files/<string:token>")
class StorageFilesApi(Resource):
    """Handle file operations through token-based URLs."""

    def get(self, token: str):
        """Download a file using a token.

        The ticket must have op="download", otherwise returns 403.
        """
        ticket = StorageTicketService.get_ticket(token)
        if ticket is None:
            raise Forbidden("Invalid or expired token")

        if ticket.op != "download":
            raise Forbidden("This token is not valid for download")

        try:
            generator = storage.load_stream(ticket.storage_key)
        except FileNotFoundError:
            raise NotFound("File not found")

        filename = ticket.filename or ticket.storage_key.rsplit("/", 1)[-1]
        encoded_filename = quote(filename)

        return Response(
            generator,
            mimetype="application/octet-stream",
            direct_passthrough=True,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            },
        )

    def put(self, token: str):
        """Upload a file using a token.

        The ticket must have op="upload", otherwise returns 403.
        If the request body exceeds max_bytes, returns 413.
        """
        ticket = StorageTicketService.get_ticket(token)
        if ticket is None:
            raise Forbidden("Invalid or expired token")

        if ticket.op != "upload":
            raise Forbidden("This token is not valid for upload")

        content = request.get_data()

        if ticket.max_bytes is not None and len(content) > ticket.max_bytes:
            raise RequestEntityTooLarge(f"Upload exceeds maximum size of {ticket.max_bytes} bytes")

        storage.save(ticket.storage_key, content)

        return Response(status=204)
