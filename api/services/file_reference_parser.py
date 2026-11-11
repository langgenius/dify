"""Parse trusted upload-file references from persisted application payloads."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from enum import Enum
from urllib.parse import unquote, urlsplit

import markdown
from bs4 import BeautifulSoup

from core.workflow.file_reference import is_canonical_file_reference, resolve_file_record_id
from services.entities.upload_file import UploadFileReferenceCandidate

CANONICAL_FILE_REFERENCE_PREFIX = "dify-file-ref:"
_CANONICAL_FILE_REFERENCE_PATTERN = re.compile(r"dify-file-ref:[A-Za-z0-9_-]+={0,2}")
_UPLOAD_FILE_TRANSFER_METHODS = frozenset(("local_file", "remote_url", "datasource_file"))


def _extract_markdown_image_sources(content: str) -> tuple[str, ...]:
    """Return image sources using the same Markdown parser as rendered content."""

    if not content:
        return ()
    rendered = markdown.markdown(content, output_format="html")
    soup = BeautifulSoup(rendered, "html.parser")
    return tuple(source for image in soup.find_all("img") if isinstance(source := image.get("src"), str) and source)


def _resolve_upload_file_id_from_preview_source(source: str) -> str | None:
    """Resolve a local upload id from an absolute or relative preview source."""

    try:
        parsed = urlsplit(source)
    except ValueError:
        return None
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None
    path_parts = unquote(parsed.path).split("/")
    for index in range(len(path_parts) - 2):
        if path_parts[index] != "files" or path_parts[index + 2] not in {"file-preview", "image-preview"}:
            continue
        file_id = path_parts[index + 1]
        if file_id:
            return file_id
    return None


def extract_upload_file_ids_from_markdown(content: str) -> tuple[str, ...]:
    """Return upload ids referenced by Markdown images, preserving occurrence order."""

    return tuple(
        file_id
        for source in _extract_markdown_image_sources(content)
        if (file_id := _resolve_upload_file_id_from_preview_source(source)) is not None
    )


def referenced_candidate_ids(
    payloads: Iterable[object],
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Resolve raw, storage-key, and opaque canonical identities in payloads."""

    by_id = {candidate.id: candidate for candidate in candidates}
    by_key: dict[str, set[str]] = {}
    for candidate in candidates:
        if candidate.key:
            by_key.setdefault(candidate.key, set()).add(candidate.id)
    referenced: set[str] = set()

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            for nested in value.values():
                visit(nested)
            return
        if isinstance(value, (list, tuple)):
            for nested in value:
                visit(nested)
            return
        if not isinstance(value, str):
            return

        referenced.update(file_id for file_id in by_id if file_id in value)
        for key, file_ids in by_key.items():
            if key in value:
                referenced.update(file_ids)
        for match in _CANONICAL_FILE_REFERENCE_PATTERN.findall(value):
            file_id = resolve_file_record_id(match)
            if file_id in by_id:
                referenced.add(file_id)

    for payload in payloads:
        visit(payload)
    return referenced


def trusted_upload_file_ids(payload: object) -> set[str]:
    """Extract UploadFile identities only from explicit persisted file shapes.

    Arbitrary payload strings and UUID-looking values are intentionally ignored:
    configuration JSON contains many unrelated business identifiers. Writers use
    this helper to fence only newly introduced, unambiguous UploadFile references.
    """

    file_ids: set[str] = set()

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            icon_type = value.get("icon_type")
            icon_type_value = icon_type.value if isinstance(icon_type, Enum) else icon_type
            if icon_type_value == "image":
                icon = value.get("icon")
                if isinstance(icon, str) and icon:
                    file_ids.add(icon)

            file_kind = value.get("file_kind")
            if file_kind == "upload_file":
                file_id = value.get("file_id")
                if isinstance(file_id, str) and file_id:
                    file_ids.add(file_id)
                return
            if file_kind == "tool_file":
                return

            transfer_method = value.get("transfer_method")
            transfer_method_value = transfer_method.value if isinstance(transfer_method, Enum) else transfer_method
            if transfer_method_value == "tool_file":
                return
            if transfer_method_value in _UPLOAD_FILE_TRANSFER_METHODS:
                id_keys = ["upload_file_id", "real_file_id"]
                if transfer_method_value == "datasource_file":
                    id_keys.append("datasource_file_id")
                for key in id_keys:
                    file_id = value.get(key)
                    if isinstance(file_id, str) and file_id:
                        file_ids.add(file_id)
                for key in ("reference", "related_id"):
                    reference = value.get(key)
                    if isinstance(reference, str):
                        file_id = resolve_file_record_id(reference)
                        if file_id is not None:
                            file_ids.add(file_id)
                return

            for nested in value.values():
                visit(nested)
            return
        if isinstance(value, (list, tuple)):
            for nested in value:
                visit(nested)
            return
        if isinstance(value, str):
            for reference in _CANONICAL_FILE_REFERENCE_PATTERN.findall(value):
                if not is_canonical_file_reference(reference):
                    continue
                file_id = resolve_file_record_id(reference)
                if file_id is not None:
                    file_ids.add(file_id)
            file_ids.update(extract_upload_file_ids_from_markdown(value))

    visit(payload)
    return file_ids


def added_trusted_upload_file_ids(*, previous: object, current: object) -> set[str]:
    """Return explicit UploadFile references introduced by one payload update."""

    return trusted_upload_file_ids(current) - trusted_upload_file_ids(previous)
