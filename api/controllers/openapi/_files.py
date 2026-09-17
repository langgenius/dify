"""Turn ``UploadPart`` values and URL strings into the file mappings the core expects.

This is the whole of file handling on ``/openapi/v1``: the CLI sends bytes under
``files[<variable>]`` (or a URL string inside ``inputs``), the openapi layer uploads
and merges, the app generators receive the same ``inputs`` a hand-written client
would have built with ``console_app.file.upload``. Core modules are untouched; the
file factory infers each file's type from the upload, so mappings carry none.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Final

from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

import services
from controllers.common.errors import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._input_schema import resolve_app_config
from extensions.ext_application_services import application_services
from models.model import App, AppMode

_CHAT_FAMILY: Final = frozenset({AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT})

MaterializedInputs = tuple[dict[str, Any], list[dict[str, Any]]]


class FileRowKind(StrEnum):
    """The two `user_input_form` row types that hold files; values are the row type strings."""

    SINGLE = "file"
    LIST = "file-list"


def file_rows_of(app: App, session: Session) -> dict[str, FileRowKind]:
    _, form = resolve_app_config(app, session=session)
    rows: dict[str, FileRowKind] = {}
    for row in form:
        if not isinstance(row, dict) or len(row) != 1:
            continue
        ((row_type, body),) = row.items()
        if row_type not in FileRowKind or not isinstance(body, dict) or not body.get("variable"):
            continue
        rows[body["variable"]] = FileRowKind(row_type)
    return rows


def _upload(part: FileStorage, caller: Any) -> dict[str, Any]:
    try:
        uploaded = application_services().files.upload_file(
            filename=part.filename or "upload",
            content=part.stream.read(),
            mimetype=part.mimetype or "application/octet-stream",
            user=caller,
        )
    except services.errors.file.FileTooLargeError as exc:
        raise FileTooLargeError(exc.description) from exc
    except services.errors.file.UnsupportedFileTypeError as exc:
        raise UnsupportedFileTypeError() from exc
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError(exc.description) from exc
    return {"transfer_method": "local_file", "upload_file_id": str(uploaded.id)}


def _remote(url: str) -> dict[str, Any]:
    return {"transfer_method": "remote_url", "url": url}


def _as_list(value: FileStorage | list[FileStorage]) -> list[FileStorage]:
    return value if isinstance(value, list) else [value]


def materialize_files(
    *,
    app: App,
    caller: Any,
    inputs: Mapping[str, Any],
    files: Mapping[str, FileStorage | list[FileStorage]] | None,
    rows: Mapping[str, FileRowKind],
) -> MaterializedInputs:
    merged: dict[str, Any] = dict(inputs)
    vision: list[dict[str, Any]] = []

    for name, value in merged.items():
        kind = rows.get(name)
        if kind is FileRowKind.SINGLE and isinstance(value, str):
            merged[name] = _remote(value)
        elif kind is FileRowKind.LIST and isinstance(value, list) and all(isinstance(v, str) for v in value):
            merged[name] = [_remote(v) for v in value]

    for name, value in (files or {}).items():
        parts = _as_list(value)
        kind = rows.get(name)
        if kind is None:
            if app.mode not in _CHAT_FAMILY:
                raise InvalidFilePart(f"files[{name}] does not match any file variable of this app")
            vision.extend(_upload(p, caller) for p in parts)
            continue
        if kind is FileRowKind.SINGLE:
            if len(parts) != 1:
                raise InvalidFilePart(f"files[{name}] takes one part, got {len(parts)}")
            merged[name] = _upload(parts[0], caller)
        else:
            merged[name] = [_upload(p, caller) for p in parts]

    return merged, vision
