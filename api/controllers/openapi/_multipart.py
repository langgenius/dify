"""One parse layer for request bodies on ``/openapi/v1``.

JSON requests validate as-is. Multipart requests become the same dict shape: every
non-file part is JSON text under its own name, every file part is named for the body
field it fills and lands there as a ``FileStorage``. The same Pydantic model validates
both; handlers never see the difference.

File part names are the field, optionally one key, optionally a ``[]`` list marker::

    file              -> body["file"] = part
    files[doc]        -> body["files"]["doc"] = part
    files[pages][]    -> body["files"]["pages"] = [part, ...]
    attachments[]     -> body["attachments"] = [part, ...]

Only the fields the model declares with ``UploadPart`` may carry file parts, so a
stray part can never land in a plain JSON field.

A JSON body sends a file as a transfer id (from ``prepare.upload``, or the id of a file
result). Inside a declared file field every string is such an id, and the parse layer
swaps it for what the transfer holds, so the model validates the same parts::

    "file": "<id>"                                  -> one part
    "attachments": ["<id>", "<id>"]                 -> a list of parts
    "files": {"doc": "<id>", "pages": ["<id>"]}     -> named parts
    "files": "<folder id>"                          -> {path: part, ...}, a folder

A folder id goes only where a mapping of parts is the whole field (``folder_fields``); every
other id must be one file. A folder id where one file is expected, or the other way round, is
refused with a 400 that names the field and says what to send. Everything outside the file
fields is left as sent.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from typing import Any, BinaryIO, Final, cast

from flask import request
from werkzeug.datastructures import FileStorage

from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._transfer import parts_of
from controllers.openapi._upload import UploadParts

LIST_SUFFIX: Final = "[]"
_PART_NAME_RE: Final = re.compile(r"^(?P<field>[^\[\]]+)(?:\[(?P<key>[^\[\]]+)\])?(?P<many>\[\])?$")
_SHAPE_HINT: Final = "file parts are named field, field[], field[key] or field[key][]"


def _json_part(name: str, raw: str, *, file_fields: Collection[str]) -> Any:
    if name in file_fields:
        raise InvalidFilePart(f"{name}: takes file parts, not JSON text")
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise InvalidFilePart(f"{name}: part must be JSON text") from exc


def _place(body: dict[str, Any], name: str, parts: list[FileStorage], *, file_fields: Collection[str]) -> None:
    match = _PART_NAME_RE.fullmatch(name)
    if match is None:
        raise InvalidFilePart(f"{name}: {_SHAPE_HINT}")
    field, key, many = match["field"], match["key"], match["many"] is not None
    if field not in file_fields:
        raise InvalidFilePart(f"{name}: {field} does not take a file")
    if not many and len(parts) != 1:
        raise InvalidFilePart(f"{name}: one part expected; name it {name}{LIST_SUFFIX} for a list")
    value: FileStorage | list[FileStorage] = parts if many else parts[0]
    target = body if key is None else body.setdefault(field, {})
    leaf = field if key is None else key
    if not isinstance(target, dict) or leaf in target:
        raise InvalidFilePart(f"{name}: given more than once")
    target[leaf] = value


def _resolved(value: Any, *, field: str, folder: bool) -> Any:
    """Postcondition: every string in ``value`` replaced by the parts of its transfer: the string ``value`` itself
    must be a folder when ``folder`` is true, and every string inside a list or mapping must be one file."""
    if isinstance(value, str):
        return parts_of(value, field=field, folder=folder)
    if isinstance(value, list):
        return [_resolved(item, field=field, folder=False) for item in value]
    if isinstance(value, dict):
        return {key: _resolved(item, field=field, folder=False) for key, item in value.items()}
    return value


def body_from_request(*, file_fields: Collection[str] = (), folder_fields: Collection[str] = ()) -> dict[str, Any]:
    if request.mimetype != "multipart/form-data":
        sent = request.get_json(silent=True) or {}
        if not isinstance(sent, dict):
            return sent
        # Every string inside a file field, at any depth, is replaced by its parts.
        return {
            name: _resolved(value, field=name, folder=name in folder_fields) if name in file_fields else value
            for name, value in sent.items()
        }
    body: dict[str, Any] = {name: _json_part(name, raw, file_fields=file_fields) for name, raw in request.form.items()}
    for name in request.files:
        _place(body, name, request.files.getlist(name), file_fields=file_fields)
    return body


def folder_streams(parts: UploadParts) -> dict[str, BinaryIO]:
    streams: dict[str, BinaryIO] = {}
    for path, part in parts.items():
        if isinstance(part, list):
            raise InvalidFilePart(f"{path}: given more than once")
        streams[path] = cast(BinaryIO, part.stream)
    return streams
