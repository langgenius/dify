"""Parse trusted upload-file references from persisted application payloads."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from enum import Enum

from core.workflow.file_reference import is_canonical_file_reference, resolve_file_record_id
from services.entities.upload_file import UploadFileReferenceCandidate

CANONICAL_FILE_REFERENCE_PREFIX = "dify-file-ref:"
_CANONICAL_FILE_REFERENCE_PATTERN = re.compile(r"dify-file-ref:[A-Za-z0-9_-]+={0,2}")
_UPLOAD_FILE_TRANSFER_METHODS = frozenset(("local_file", "remote_url", "datasource_file"))

# Persisted content is attacker-controlled (chat inputs, model answers, crawled
# pages), so these patterns must stay linear in the input length: every
# unbounded character class excludes the delimiter that opens the next
# candidate, so failed attempts never rescan the same text.
_MARKDOWN_LABEL = r"(?:[^\[\]\\]|\\.)*"
_MARKDOWN_IMAGE_PATTERN = re.compile(
    rf"!\[(?P<alt>{_MARKDOWN_LABEL})\](?:\(\s*<?(?P<destination>[^\s()<>]*)|\[(?P<label>[^\[\]]*)\])?"
)
_MARKDOWN_REFERENCE_DEFINITION_PATTERN = re.compile(
    rf"^[ \t]{{0,3}}\[(?P<label>{_MARKDOWN_LABEL})\]:[ \t]*\n?[ \t]*<?(?P<destination>[^\s<>]+)",
    re.MULTILINE,
)
_HTML_IMAGE_SOURCE_PATTERN = re.compile(
    r"""<img\b[^<>]*?(?<![\w-])src\s*=\s*(?:"(?P<double>[^"<>]*)"|'(?P<single>[^'<>]*)'|(?P<bare>[^\s"'<>]+))""",
    re.IGNORECASE,
)
_PREVIEW_SOURCE_PATTERN = re.compile(
    r"(?:(?P<scheme>[A-Za-z][A-Za-z0-9+.-]*):)?(?:[^\s()<>?#]*?/)?files/"
    r"(?P<file_id>[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"
    r"/(?:file|image)-preview(?=[/?#]|$)"
)
_PREVIEW_SOURCE_MARKER = "-preview"


class TextLinkedUploadFileId(str):  # noqa: FURB189 - a marker type; no str behavior is overridden
    """An upload id that ``trusted_upload_file_ids`` found only in free text.

    Free text (chat inputs, model answers, crawled pages, document chunks) may
    link previews of files this tenant never owned or has since deleted, and it
    was always stored as written. The marker compares and hashes as its plain
    id and survives the set, ``sorted`` and ``tuple`` operations writers apply,
    so ``lock_and_validate_owned_upload_files_in_session`` can lock such files
    when they exist without rejecting the write when they do not. Converting
    with ``str()`` drops the marker and restores hard validation.
    """

    __slots__ = ()


def _normalize_markdown_label(label: str) -> str:
    return " ".join(label.split()).casefold()


def _extract_markdown_image_sources(content: str) -> tuple[str, ...]:
    """Return image sources in occurrence order using a single linear scan.

    Inline images, reference-style images (full, collapsed and shortcut) and
    raw ``<img src>`` tags are recognized. This is a conservative superset of
    rendered Markdown: images inside code spans are reported too.
    """

    if _PREVIEW_SOURCE_MARKER not in content:
        return ()
    definitions: dict[str, str] = {}
    for match in _MARKDOWN_REFERENCE_DEFINITION_PATTERN.finditer(content):
        definitions.setdefault(_normalize_markdown_label(match["label"]), match["destination"])

    sources: list[tuple[int, str]] = []
    for match in _MARKDOWN_IMAGE_PATTERN.finditer(content):
        destination = match["destination"]
        if destination is None:
            label = match["label"] or match["alt"]
            destination = definitions.get(_normalize_markdown_label(label))
        if destination:
            sources.append((match.start(), destination))
    for match in _HTML_IMAGE_SOURCE_PATTERN.finditer(content):
        source = match["double"] or match["single"] or match["bare"]
        if source:
            sources.append((match.start(), source))
    sources.sort()
    return tuple(source for _, source in sources)


def _resolve_upload_file_id_from_preview_source(source: str) -> str | None:
    """Resolve a local upload id from an absolute or relative preview source.

    Only UUID-shaped ids are accepted: any other path segment cannot name an
    UploadFile row and must never reach a UUID-typed column comparison.
    """

    match = _PREVIEW_SOURCE_PATTERN.match(source)
    if match is None:
        return None
    scheme = match["scheme"]
    if scheme is not None and scheme.lower() not in {"http", "https"}:
        return None
    return match["file_id"].lower()


def extract_upload_file_ids_from_markdown(content: str) -> tuple[str, ...]:
    """Return upload ids referenced by Markdown images, preserving occurrence order.

    Parsing is linear in ``len(content)``. Ids are UUID-shaped and lower-cased;
    they are not proof that a file exists or belongs to the caller's tenant.
    """

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

    Ids from typed file mappings, image icons and canonical ``dify-file-ref:``
    references are plain strings and must resolve to tenant files. Ids found
    only in Markdown image links are ``TextLinkedUploadFileId`` values: they
    still count as references, but writers treat a missing file as tolerable.
    """

    file_ids: set[str] = set()
    text_linked_ids: set[str] = set()

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
            text_linked_ids.update(extract_upload_file_ids_from_markdown(value))

    visit(payload)
    # A structured reference to the same id wins, keeping its hard validation.
    file_ids.update(TextLinkedUploadFileId(file_id) for file_id in text_linked_ids - file_ids)
    return file_ids


def added_trusted_upload_file_ids(*, previous: object, current: object) -> set[str]:
    """Return explicit UploadFile references introduced by one payload update."""

    return trusted_upload_file_ids(current) - trusted_upload_file_ids(previous)
