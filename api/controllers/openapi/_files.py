"""Turn ``UploadPart`` values into the file mappings the core expects.

The part name says where a file goes; nothing here reads the app. ``files[<name>]``
becomes ``inputs[<name>]``, and the ``[]`` list marker on the part name is what makes
a list. The core validates the result against the variable's own config, exactly as
it does for a hand-written mapping. Remote URLs and reused upload ids are sent as
mappings inside ``inputs``, the same as on every other Dify API.

Every mapping carries a ``type``: ``build_from_mapping`` validates ``mapping["type"]
or FileType.CUSTOM`` against the variable's upload config, and ``custom`` is refused
by every normally configured file variable. The type comes from the core's own
``standardize_file_type`` over the stored upload row.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest

import services
from controllers.common.errors import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from controllers.openapi._errors import FilenameNotExists, InvalidFilePart
from extensions.ext_application_services import application_services
from graphon.file import FileTransferMethod, standardize_file_type
from models.model import UploadFile

FileMapping = dict[str, Any]


def end_read_transaction(session: Session) -> None:
    """Close the transaction the router's loaders opened before a handler writes to object storage.

    `api/AGENTS.md` keeps external I/O out of open transactions. The router's sessions do
    not expire on commit, so the rows the requirements loaded stay readable afterwards,
    and the service that runs next begins its own transaction on the same session.
    """
    session.commit()


def upload(part: FileStorage, caller: Any) -> UploadFile:
    if not part.mimetype:
        raise UnsupportedFileTypeError()
    if not part.filename:
        raise FilenameNotExists()
    try:
        return application_services().files.upload_file(
            filename=part.filename,
            content=part.stream.read(),
            mimetype=part.mimetype,
            user=caller,
        )
    except services.errors.file.FileTooLargeError as exc:
        raise FileTooLargeError(exc.description) from exc
    except services.errors.file.UnsupportedFileTypeError as exc:
        raise UnsupportedFileTypeError() from exc
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError(exc.description) from exc
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc


def _mapping(part: FileStorage, caller: Any) -> FileMapping:
    uploaded = upload(part, caller)
    return {
        "transfer_method": FileTransferMethod.LOCAL_FILE,
        "upload_file_id": str(uploaded.id),
        "type": standardize_file_type(extension="." + uploaded.extension, mime_type=uploaded.mime_type),
    }


def materialize(value: FileStorage | list[FileStorage], caller: Any) -> FileMapping | list[FileMapping]:
    if isinstance(value, list):
        return [_mapping(part, caller) for part in value]
    return _mapping(value, caller)


def merge_files(
    inputs: Mapping[str, Any], files: Mapping[str, FileStorage | list[FileStorage]] | None, caller: Any
) -> dict[str, Any]:
    merged = dict(inputs)
    for name, value in (files or {}).items():
        if name in merged:
            raise InvalidFilePart(f"files[{name}]: {name} is also given in inputs")
        merged[name] = materialize(value, caller)
    return merged
