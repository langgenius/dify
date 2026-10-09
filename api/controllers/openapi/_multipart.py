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
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from typing import Any, Final

from flask import request
from werkzeug.datastructures import FileStorage

from controllers.openapi._errors import InvalidFilePart

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
    if leaf in target:
        raise InvalidFilePart(f"{name}: given more than once")
    target[leaf] = value


def body_from_request(*, file_fields: Collection[str] = ()) -> dict[str, Any]:
    if request.mimetype != "multipart/form-data":
        return request.get_json(silent=True) or {}
    body: dict[str, Any] = {name: _json_part(name, raw, file_fields=file_fields) for name, raw in request.form.items()}
    for name in request.files:
        _place(body, name, request.files.getlist(name), file_fields=file_fields)
    return body
