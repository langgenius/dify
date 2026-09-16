"""One parse layer for request bodies on ``/openapi/v1``.

JSON requests validate as-is. Multipart requests become the same dict shape: every
non-file part is JSON text, every file part is named ``files[<name>]`` and lands under
``body["files"][<name>]`` (a single ``FileStorage`` or a list when repeated). The same
Pydantic model validates both; handlers never see the difference.
"""

from __future__ import annotations

import json
import re
from typing import Any, Final

from flask import request
from werkzeug.datastructures import FileStorage

from controllers.openapi._errors import InvalidFilePart

FILE_PART_RE: Final = re.compile(r"^files\[(?P<name>[^\]]+)\]$")
FILES_FIELD: Final = "files"


def _json_part(name: str, raw: str) -> Any:
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise InvalidFilePart(f"{name}: part must be JSON text") from exc


def _file_parts() -> dict[str, FileStorage | list[FileStorage]]:
    files: dict[str, FileStorage | list[FileStorage]] = {}
    for key in request.files:
        match = FILE_PART_RE.fullmatch(key)
        if match is None:
            raise InvalidFilePart(f"{key}: file parts must be named files[<name>]")
        storages = request.files.getlist(key)
        files[match["name"]] = storages[0] if len(storages) == 1 else storages
    return files


def body_from_request() -> dict[str, Any]:
    if request.mimetype != "multipart/form-data":
        return request.get_json(silent=True) or {}
    body: dict[str, Any] = {name: _json_part(name, raw) for name, raw in request.form.items()}
    files = _file_parts()
    if files:
        body[FILES_FIELD] = files
    return body
