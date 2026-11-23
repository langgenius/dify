"""Render an authorized CSV export download."""

from http import HTTPStatus
from itertools import chain

from flask import Response

from services.retention.log_export_task import LogExportDownload


def log_export_file_response(download: LogExportDownload, *, filename: str) -> Response:
    """Redirect to a signed URL or attach the CSV and close its stream with the response."""
    if isinstance(download, str):
        response = Response(status=HTTPStatus.FOUND, headers={"Location": download})
    else:
        first_chunk, stream = download
        response = Response(chain((first_chunk,), stream), mimetype="text/csv")
        response.headers.set("Content-Disposition", "attachment", filename=filename)
        response.call_on_close(stream.close)
    response.cache_control.no_store = True
    return response
