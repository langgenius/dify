import logging
import mimetypes
import os
import re
import urllib.parse
import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.http import parse_options_header

from constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from core.file import File, FileBelongsTo, FileTransferMethod, FileType, FileUploadConfig, helpers
from core.helper import ssrf_proxy
from extensions.ext_database import db
from models import MessageFile, ToolFile, UploadFile

logger = logging.getLogger(__name__)


def build_from_message_files(
    *,
    message_files: Sequence["MessageFile"],
    tenant_id: str,
    config: FileUploadConfig | None = None,
) -> Sequence[File]:
    results = [
        build_from_message_file(message_file=file, tenant_id=tenant_id, config=config)
        for file in message_files
        if file.belongs_to != FileBelongsTo.ASSISTANT
    ]
    return results


def build_from_message_file(
    *,
    message_file: "MessageFile",
    tenant_id: str,
    config: FileUploadConfig | None,
):
    mapping = {
        "transfer_method": message_file.transfer_method,
        "url": message_file.url,
        "type": message_file.type,
    }

    # Only include id if it exists (message_file has been committed to DB)
    if message_file.id:
        mapping["id"] = message_file.id

    # Set the correct ID field based on transfer method
    if message_file.transfer_method == FileTransferMethod.TOOL_FILE:
        mapping["tool_file_id"] = message_file.upload_file_id
    else:
        mapping["upload_file_id"] = message_file.upload_file_id

    return build_from_mapping(
        mapping=mapping,
        tenant_id=tenant_id,
        config=config,
    )


def build_from_mapping(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    config: FileUploadConfig | None = None,
    strict_type_validation: bool = False,
) -> File:
    transfer_method_value = mapping.get("transfer_method")
    if not transfer_method_value:
        raise ValueError("transfer_method is required in file mapping")
    transfer_method = FileTransferMethod.value_of(transfer_method_value)

    build_functions: dict[FileTransferMethod, Callable] = {
        FileTransferMethod.LOCAL_FILE: _build_from_local_file,
        FileTransferMethod.REMOTE_URL: _build_from_remote_url,
        FileTransferMethod.TOOL_FILE: _build_from_tool_file,
        FileTransferMethod.DATASOURCE_FILE: _build_from_datasource_file,
    }

    build_func = build_functions.get(transfer_method)
    if not build_func:
        raise ValueError(f"Invalid file transfer method: {transfer_method}")

    file: File = build_func(
        mapping=mapping,
        tenant_id=tenant_id,
        transfer_method=transfer_method,
        strict_type_validation=strict_type_validation,
    )

    if config and not _is_file_valid_with_config(
        input_file_type=mapping.get("type", FileType.CUSTOM),
        file_extension=file.extension or "",
        file_transfer_method=file.transfer_method,
        config=config,
    ):
        raise ValueError(f"File validation failed for file: {file.filename}")

    return file


def build_from_mappings(
    *,
    mappings: Sequence[Mapping[str, Any]],
    config: FileUploadConfig | None = None,
    tenant_id: str,
    strict_type_validation: bool = False,
) -> Sequence[File]:
    # TODO(QuantumGhost): Performance concern - each mapping triggers a separate database query.
    # Implement batch processing to reduce database load when handling multiple files.
    # Filter out None/empty mappings to avoid errors
    def is_valid_mapping(m: Mapping[str, Any]) -> bool:
        if not m or not m.get("transfer_method"):
            return False
        # For REMOTE_URL transfer method, ensure url or remote_url is provided and not None
        transfer_method = m.get("transfer_method")
        if transfer_method == FileTransferMethod.REMOTE_URL:
            url = m.get("url") or m.get("remote_url")
            if not url:
                return False
        return True

    valid_mappings = [m for m in mappings if is_valid_mapping(m)]
    files = [
        build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            config=config,
            strict_type_validation=strict_type_validation,
        )
        for mapping in valid_mappings
    ]

    if (
        config
        # If image config is set.
        and config.image_config
        # And the number of image files exceeds the maximum limit
        and sum(1 for _ in (filter(lambda x: x.type == FileType.IMAGE, files))) > config.image_config.number_limits
    ):
        raise ValueError(f"Number of image files exceeds the maximum limit {config.image_config.number_limits}")
    if config and config.number_limits and len(files) > config.number_limits:
        raise ValueError(f"Number of files exceeds the maximum limit {config.number_limits}")

    return files


def _build_from_local_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
) -> File:
    upload_file_id = mapping.get("upload_file_id")
    if not upload_file_id:
        raise ValueError("Invalid upload file id")
    # check if upload_file_id is a valid uuid
    try:
        uuid.UUID(upload_file_id)
    except ValueError:
        raise ValueError("Invalid upload file id format")
    stmt = select(UploadFile).where(
        UploadFile.id == upload_file_id,
        UploadFile.tenant_id == tenant_id,
    )

    row = db.session.scalar(stmt)
    if row is None:
        raise ValueError("Invalid upload file")

    detected_file_type = _standardize_file_type(extension="." + row.extension, mime_type=row.mime_type)
    specified_type = mapping.get("type", "custom")

    if strict_type_validation and detected_file_type.value != specified_type:
        raise ValueError("Detected file type does not match the specified type. Please verify the file.")

    if specified_type and specified_type != "custom":
        file_type = FileType(specified_type)
    else:
        file_type = detected_file_type

    return File(
        id=mapping.get("id"),
        filename=row.name,
        extension="." + row.extension,
        mime_type=row.mime_type,
        tenant_id=tenant_id,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=row.source_url,
        related_id=mapping.get("upload_file_id"),
        size=row.size,
        storage_key=row.key,
    )


def _build_from_remote_url(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
) -> File:
    upload_file_id = mapping.get("upload_file_id")
    if upload_file_id:
        try:
            uuid.UUID(upload_file_id)
        except ValueError:
            raise ValueError("Invalid upload file id format")
        stmt = select(UploadFile).where(
            UploadFile.id == upload_file_id,
            UploadFile.tenant_id == tenant_id,
        )

        upload_file = db.session.scalar(stmt)
        if upload_file is None:
            raise ValueError("Invalid upload file")

        detected_file_type = _standardize_file_type(
            extension="." + upload_file.extension, mime_type=upload_file.mime_type
        )

        specified_type = mapping.get("type")

        if strict_type_validation and specified_type and detected_file_type.value != specified_type:
            raise ValueError("Detected file type does not match the specified type. Please verify the file.")

        if specified_type and specified_type != "custom":
            file_type = FileType(specified_type)
        else:
            file_type = detected_file_type

        return File(
            id=mapping.get("id"),
            filename=upload_file.name,
            extension="." + upload_file.extension,
            mime_type=upload_file.mime_type,
            tenant_id=tenant_id,
            type=file_type,
            transfer_method=transfer_method,
            remote_url=helpers.get_signed_file_url(upload_file_id=str(upload_file_id)),
            related_id=mapping.get("upload_file_id"),
            size=upload_file.size,
            storage_key=upload_file.key,
        )
    url = mapping.get("url") or mapping.get("remote_url")
    if not url:
        raise ValueError("Invalid file url")

    mime_type, filename, file_size = _get_remote_file_info(url)
    extension = mimetypes.guess_extension(mime_type) or ("." + filename.split(".")[-1] if "." in filename else ".bin")

    detected_file_type = _standardize_file_type(extension=extension, mime_type=mime_type)
    specified_type = mapping.get("type")

    if strict_type_validation and specified_type and detected_file_type.value != specified_type:
        raise ValueError("Detected file type does not match the specified type. Please verify the file.")

    if specified_type and specified_type != "custom":
        file_type = FileType(specified_type)
    else:
        file_type = detected_file_type

    return File(
        id=mapping.get("id"),
        filename=filename,
        tenant_id=tenant_id,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=url,
        mime_type=mime_type,
        extension=extension,
        size=file_size,
        storage_key="",
    )


def _extract_filename(url_path: str, content_disposition: str | None) -> str | None:
    filename: str | None = None
    # Try to extract from Content-Disposition header first
    if content_disposition:
        # Manually extract filename* parameter since parse_options_header doesn't support it
        filename_star_match = re.search(r"filename\*=([^;]+)", content_disposition)
        if filename_star_match:
            raw_star = filename_star_match.group(1).strip()
            # Remove trailing quotes if present
            raw_star = raw_star.removesuffix('"')
            # format: charset'lang'value
            try:
                parts = raw_star.split("'", 2)
                charset = (parts[0] or "utf-8").lower() if len(parts) >= 1 else "utf-8"
                value = parts[2] if len(parts) == 3 else parts[-1]
                filename = urllib.parse.unquote(value, encoding=charset, errors="replace")
            except Exception:
                # Fallback: try to extract value after the last single quote
                if "''" in raw_star:
                    filename = urllib.parse.unquote(raw_star.split("''")[-1])
                else:
                    filename = urllib.parse.unquote(raw_star)

        if not filename:
            # Fallback to regular filename parameter
            _, params = parse_options_header(content_disposition)
            raw = params.get("filename")
            if raw:
                # Strip surrounding quotes and percent-decode if present
                if len(raw) >= 2 and raw[0] == raw[-1] == '"':
                    raw = raw[1:-1]
                filename = urllib.parse.unquote(raw)
    # Fallback to URL path if no filename from header
    if not filename:
        candidate = os.path.basename(url_path)
        filename = urllib.parse.unquote(candidate) if candidate else None
    # Defense-in-depth: ensure basename only
    if filename:
        filename = os.path.basename(filename)
        # Return None if filename is empty or only whitespace
        if not filename or not filename.strip():
            filename = None
    return filename or None


def _guess_mime_type(filename: str) -> str:
    """Guess MIME type from filename, returning empty string if None."""
    guessed_mime, _ = mimetypes.guess_type(filename)
    return guessed_mime or ""


def _get_remote_file_info(url: str):
    file_size = -1
    parsed_url = urllib.parse.urlparse(url)
    url_path = parsed_url.path
    filename = os.path.basename(url_path)

    # Initialize mime_type from filename as fallback
    mime_type = _guess_mime_type(filename)

    resp = ssrf_proxy.head(url, follow_redirects=True)
    if resp.status_code == httpx.codes.OK:
        content_disposition = resp.headers.get("Content-Disposition")
        extracted_filename = _extract_filename(url_path, content_disposition)
        if extracted_filename:
            filename = extracted_filename
            mime_type = _guess_mime_type(filename)
        file_size = int(resp.headers.get("Content-Length", file_size))
        # Fallback to Content-Type header if mime_type is still empty
        if not mime_type:
            mime_type = resp.headers.get("Content-Type", "").split(";")[0].strip()

    if not filename:
        extension = mimetypes.guess_extension(mime_type) or ".bin"
        filename = f"{uuid.uuid4().hex}{extension}"
        if not mime_type:
            mime_type = _guess_mime_type(filename)

    return mime_type, filename, file_size


def _build_from_tool_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
) -> File:
    # Backward/interop compatibility: allow tool_file_id to come from related_id or URL
    tool_file_id = mapping.get("tool_file_id")

    if not tool_file_id:
        raise ValueError(f"ToolFile {tool_file_id} not found")
    tool_file = db.session.scalar(
        select(ToolFile).where(
            ToolFile.id == tool_file_id,
            ToolFile.tenant_id == tenant_id,
        )
    )

    if tool_file is None:
        raise ValueError(f"ToolFile {tool_file_id} not found")

    extension = "." + tool_file.file_key.split(".")[-1] if "." in tool_file.file_key else ".bin"

    detected_file_type = _standardize_file_type(extension=extension, mime_type=tool_file.mimetype)

    specified_type = mapping.get("type")

    if strict_type_validation and specified_type and detected_file_type.value != specified_type:
        raise ValueError("Detected file type does not match the specified type. Please verify the file.")

    if specified_type and specified_type != "custom":
        file_type = FileType(specified_type)
    else:
        file_type = detected_file_type

    return File(
        id=mapping.get("id"),
        tenant_id=tenant_id,
        filename=tool_file.name,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=tool_file.original_url,
        related_id=tool_file.id,
        extension=extension,
        mime_type=tool_file.mimetype,
        size=tool_file.size,
        storage_key=tool_file.file_key,
    )


def _build_from_datasource_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
) -> File:
    datasource_file_id = mapping.get("datasource_file_id")
    if not datasource_file_id:
        raise ValueError(f"DatasourceFile {datasource_file_id} not found")
    datasource_file = (
        db.session.query(UploadFile)
        .where(
            UploadFile.id == datasource_file_id,
            UploadFile.tenant_id == tenant_id,
        )
        .first()
    )

    if datasource_file is None:
        raise ValueError(f"DatasourceFile {mapping.get('datasource_file_id')} not found")

    extension = "." + datasource_file.key.split(".")[-1] if "." in datasource_file.key else ".bin"

    detected_file_type = _standardize_file_type(extension="." + extension, mime_type=datasource_file.mime_type)

    specified_type = mapping.get("type")

    if strict_type_validation and specified_type and detected_file_type.value != specified_type:
        raise ValueError("Detected file type does not match the specified type. Please verify the file.")

    if specified_type and specified_type != "custom":
        file_type = FileType(specified_type)
    else:
        file_type = detected_file_type

    return File(
        id=mapping.get("datasource_file_id"),
        tenant_id=tenant_id,
        filename=datasource_file.name,
        type=file_type,
        transfer_method=FileTransferMethod.TOOL_FILE,
        remote_url=datasource_file.source_url,
        related_id=datasource_file.id,
        extension=extension,
        mime_type=datasource_file.mime_type,
        size=datasource_file.size,
        storage_key=datasource_file.key,
        url=datasource_file.source_url,
    )


def _is_file_valid_with_config(
    *,
    input_file_type: str,
    file_extension: str,
    file_transfer_method: FileTransferMethod,
    config: FileUploadConfig,
) -> bool:
    # FIXME(QIN2DIM): Always allow tool files (files generated by the assistant/model)
    # These are internally generated and should bypass user upload restrictions
    if file_transfer_method == FileTransferMethod.TOOL_FILE:
        return True

    if (
        config.allowed_file_types
        and input_file_type not in config.allowed_file_types
        and input_file_type != FileType.CUSTOM
    ):
        return False

    if (
        input_file_type == FileType.CUSTOM
        and config.allowed_file_extensions is not None
        and file_extension not in config.allowed_file_extensions
    ):
        return False

    if input_file_type == FileType.IMAGE:
        if (
            config.image_config
            and config.image_config.transfer_methods
            and file_transfer_method not in config.image_config.transfer_methods
        ):
            return False
    elif config.allowed_file_upload_methods and file_transfer_method not in config.allowed_file_upload_methods:
        return False

    return True


def _standardize_file_type(*, extension: str = "", mime_type: str = "") -> FileType:
    """
    Infer the possible actual type of the file based on the extension and mime_type
    """
    guessed_type = None
    if extension:
        guessed_type = _get_file_type_by_extension(extension)
    if guessed_type is None and mime_type:
        guessed_type = _get_file_type_by_mimetype(mime_type)
    return guessed_type or FileType.CUSTOM


def _get_file_type_by_extension(extension: str) -> FileType | None:
    extension = extension.lstrip(".")
    if extension in IMAGE_EXTENSIONS:
        return FileType.IMAGE
    elif extension in VIDEO_EXTENSIONS:
        return FileType.VIDEO
    elif extension in AUDIO_EXTENSIONS:
        return FileType.AUDIO
    elif extension in DOCUMENT_EXTENSIONS:
        return FileType.DOCUMENT
    return None


def _get_file_type_by_mimetype(mime_type: str) -> FileType | None:
    if "image" in mime_type:
        file_type = FileType.IMAGE
    elif "video" in mime_type:
        file_type = FileType.VIDEO
    elif "audio" in mime_type:
        file_type = FileType.AUDIO
    elif "text" in mime_type or "pdf" in mime_type:
        file_type = FileType.DOCUMENT
    else:
        file_type = FileType.CUSTOM
    return file_type


def get_file_type_by_mime_type(mime_type: str) -> FileType:
    return _get_file_type_by_mimetype(mime_type) or FileType.CUSTOM


class StorageKeyLoader:
    """FileKeyLoader load the storage key from database for a list of files.
    This loader is batched, the database query count is constant regardless of the input size.
    """

    def __init__(self, session: Session, tenant_id: str):
        self._session = session
        self._tenant_id = tenant_id

    def _load_upload_files(self, upload_file_ids: Sequence[uuid.UUID]) -> Mapping[uuid.UUID, UploadFile]:
        stmt = select(UploadFile).where(
            UploadFile.id.in_(upload_file_ids),
            UploadFile.tenant_id == self._tenant_id,
        )

        return {uuid.UUID(i.id): i for i in self._session.scalars(stmt)}

    def _load_tool_files(self, tool_file_ids: Sequence[uuid.UUID]) -> Mapping[uuid.UUID, ToolFile]:
        stmt = select(ToolFile).where(
            ToolFile.id.in_(tool_file_ids),
            ToolFile.tenant_id == self._tenant_id,
        )
        return {uuid.UUID(i.id): i for i in self._session.scalars(stmt)}

    def load_storage_keys(self, files: Sequence[File]):
        """Loads storage keys for a sequence of files by retrieving the corresponding
        `UploadFile` or `ToolFile` records from the database based on their transfer method.

        This method doesn't modify the input sequence structure but updates the `_storage_key`
        property of each file object by extracting the relevant key from its database record.

        Performance note: This is a batched operation where database query count remains constant
        regardless of input size. However, for optimal performance, input sequences should contain
        fewer than 1000 files. For larger collections, split into smaller batches and process each
        batch separately.
        """

        upload_file_ids: list[uuid.UUID] = []
        tool_file_ids: list[uuid.UUID] = []
        for file in files:
            related_model_id = file.related_id
            if file.related_id is None:
                raise ValueError("file id should not be None.")
            if file.tenant_id != self._tenant_id:
                err_msg = (
                    f"invalid file, expected tenant_id={self._tenant_id}, "
                    f"got tenant_id={file.tenant_id}, file_id={file.id}, related_model_id={related_model_id}"
                )
                raise ValueError(err_msg)
            model_id = uuid.UUID(related_model_id)

            if file.transfer_method in (FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL):
                upload_file_ids.append(model_id)
            elif file.transfer_method == FileTransferMethod.TOOL_FILE:
                tool_file_ids.append(model_id)

        tool_files = self._load_tool_files(tool_file_ids)
        upload_files = self._load_upload_files(upload_file_ids)
        for file in files:
            model_id = uuid.UUID(file.related_id)
            if file.transfer_method in (FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL):
                upload_file_row = upload_files.get(model_id)
                if upload_file_row is None:
                    raise ValueError(f"Upload file not found for id: {model_id}")
                file.storage_key = upload_file_row.key
            elif file.transfer_method == FileTransferMethod.TOOL_FILE:
                tool_file_row = tool_files.get(model_id)
                if tool_file_row is None:
                    raise ValueError(f"Tool file not found for id: {model_id}")
                file.storage_key = tool_file_row.file_key
