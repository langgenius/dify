"""Read-only DOCX evidence behind tenant-owned native Tool file references.

No URLs are fetched and no archive members are extracted. Native File metadata
identifies a ToolFile row; only that tenant-scoped row supplies the storage key.
This proves a bounded OOXML document package, not its prose or visual quality.
"""

from __future__ import annotations

import logging
import posixpath
import zlib
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from urllib.parse import unquote, urlsplit
from uuid import UUID
from xml.etree.ElementTree import Element, ParseError
from zipfile import BadZipFile, ZipFile

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from sqlalchemy import select

from core.dify_builder.models import Graph, Run
from core.workflow.file_reference import parse_file_reference
from services.dify_builder.revision import executable_graph_revision

logger = logging.getLogger(__name__)
_MAX_FILES = 16
_MAX_ARCHIVE_ENTRIES = 256
_MAX_XML_BYTES = 2 * 1024 * 1024
_CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
_WORD_NAMESPACES = {
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
}
_RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_OFFICE_DOCUMENT_RELATIONSHIPS = {
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
}
_DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"


@dataclass(frozen=True)
class FileAcceptance:
    state: Literal["passed", "failed", "unverified"]
    reason: str


@dataclass(frozen=True)
class StoredToolFile:
    id: str
    tenant_id: str
    file_key: str
    size: int


def _file_identity(value: object) -> tuple[str, str | None] | None:
    if not isinstance(value, Mapping) or (
        value.get("dify_model_identity") != "__dify__file__" or value.get("transfer_method") != "tool_file"
    ):
        return None
    reference = value.get("reference")
    if not isinstance(reference, str) or len(reference) > 2048:
        return None
    try:
        parsed = parse_file_reference(reference)
    except (AttributeError, TypeError, ValueError):
        return None
    if parsed is None:
        return None
    try:
        file_id = str(UUID(parsed.record_id))
        related = value.get("related_id")
        if related is not None and (not isinstance(related, str) or str(UUID(related)) != file_id):
            return None
    except ValueError:
        return None
    return file_id, parsed.storage_key


def _observed_tool_file_ids(run: Run, graph: Graph) -> set[str]:
    evidence = run.verification
    if not run.immutable or run.kind != "verify" or run.status != "succeeded" or evidence is None:
        return set()
    if not evidence.execution_revision or executable_graph_revision(graph) != evidence.executed_graph_revision:
        return set()
    summary = evidence.execution_evidence
    if summary is None or not summary.sealed or summary.native_run_id != run.dify_run_id or not run.dify_run_id:
        return set()
    tools = {node.get("id") for node in graph.get("nodes", []) if (node.get("data") or {}).get("type") == "tool"}
    observed = set()
    for row in run.per_node:
        if (
            row.node_id not in tools
            or row.node_id not in evidence.executed_node_ids
            or row.status != "succeeded"
            or not row.outputs_available
            or row.node_id in summary.simulated_node_ids
        ):
            continue
        files = row.outputs.get("files")
        if not isinstance(files, list) or len(files) > _MAX_FILES:
            continue
        for value in files:
            identity = _file_identity(value)
            if identity is not None:
                observed.add(identity[0])
    return observed


class _XmlLimitError(ValueError):
    """An encrypted or oversized part cannot be verified within the read bound."""


def _xml_part(package: ZipFile, name: str) -> Element:
    info = package.getinfo(name)
    if info.flag_bits & 1 or info.file_size > _MAX_XML_BYTES:
        raise _XmlLimitError
    with package.open(info) as member:
        part = member.read(_MAX_XML_BYTES + 1)
    if len(part) > _MAX_XML_BYTES:
        raise _XmlLimitError
    return ElementTree.fromstring(part, forbid_dtd=True)


def _package_evidence(blob: bytes, *, max_uncompressed_bytes: int) -> FileAcceptance:
    try:
        with ZipFile(BytesIO(blob)) as package:
            entries = package.infolist()
            if (
                len(entries) > _MAX_ARCHIVE_ENTRIES
                or sum(entry.file_size for entry in entries) > max_uncompressed_bytes
            ):
                return FileAcceptance("unverified", "docx_archive_limit")
            names = [entry.filename for entry in entries]
            if any(names.count(name) != 1 for name in ("[Content_Types].xml", "_rels/.rels")):
                return FileAcceptance("failed", "docx_parts_invalid")
            content_types = _xml_part(package, "[Content_Types].xml")
            relationships = _xml_part(package, "_rels/.rels")
            if relationships.tag != f"{{{_RELATIONSHIPS_NS}}}Relationships":
                return FileAcceptance("failed", "docx_relationship_invalid")
            main_relationships = [
                item
                for item in relationships
                if item.tag == f"{{{_RELATIONSHIPS_NS}}}Relationship"
                and item.attrib.get("Type") in _OFFICE_DOCUMENT_RELATIONSHIPS
            ]
            if (
                len(main_relationships) != 1
                or not main_relationships[0].attrib.get("Id")
                or main_relationships[0].attrib.get("TargetMode", "Internal") != "Internal"
            ):
                return FileAcceptance("failed", "docx_relationship_invalid")
            target = main_relationships[0].attrib.get("Target", "")
            parsed = urlsplit(target)
            if not target or parsed.scheme or parsed.netloc or "?" in target or "#" in target or "\\" in target:
                return FileAcceptance("failed", "docx_relationship_invalid")
            # A root relationship resolves within this ZIP, never a URL or an
            # extracted filesystem path. Decode before checking root traversal.
            main_part = posixpath.normpath(unquote(parsed.path).removeprefix("/"))
            if main_part in {".", ".."} or main_part.startswith(("../", "/")) or names.count(main_part) != 1:
                return FileAcceptance("failed", "docx_relationship_invalid")
            main_content_types = [
                item
                for item in content_types
                if item.tag == f"{{{_CONTENT_TYPES_NS}}}Override" and item.attrib.get("PartName") == "/" + main_part
            ]
            if (
                content_types.tag != f"{{{_CONTENT_TYPES_NS}}}Types"
                or len(main_content_types) != 1
                or main_content_types[0].attrib.get("ContentType") != _DOCX_CONTENT_TYPE
            ):
                return FileAcceptance("failed", "docx_content_type_invalid")
            document = _xml_part(package, main_part)
            if not any(
                document.tag == f"{{{namespace}}}document" and document.find(f"{{{namespace}}}body") is not None
                for namespace in _WORD_NAMESPACES
            ):
                return FileAcceptance("failed", "docx_document_invalid")
    except _XmlLimitError:
        return FileAcceptance("unverified", "docx_xml_limit")
    except (
        BadZipFile,
        ParseError,
        DefusedXmlException,
        RuntimeError,
        NotImplementedError,
        EOFError,
        ValueError,
        zlib.error,
    ):
        return FileAcceptance("failed", "docx_package_invalid")
    return FileAcceptance("passed", "docx_bytes_validated")


def validate_native_docx(
    value: object,
    *,
    tenant_id: str,
    run: Run,
    native_graph: Graph,
    lookup_file: Callable[[str, str], StoredToolFile | None],
    load_stream: Callable[[str], Iterable[bytes]],
    max_file_bytes: int = 10 * 1024 * 1024,
    max_uncompressed_bytes: int = 20 * 1024 * 1024,
) -> FileAcceptance:
    """Validate one native file or a bounded list using injected read-only owners.

    All external lookup/read failures remain unverified, preserving the caller's
    already completed Run. A readable owned file with invalid bytes fails the
    explicit file expectation. One validated DOCX satisfies a file-list check.
    """
    if max_file_bytes <= 0 or max_uncompressed_bytes <= 0:
        raise ValueError("DOCX read bounds must be positive")
    values = value if isinstance(value, list) else [value]
    if not values:
        return FileAcceptance("failed", "required_docx_missing")
    if len(values) > _MAX_FILES or not tenant_id:
        return FileAcceptance("unverified", "native_file_evidence_unavailable")
    observed = _observed_tool_file_ids(run, native_graph)
    results = []
    for item in values:
        identity = _file_identity(item)
        if identity is None or identity[0] not in observed:
            results.append(FileAcceptance("unverified", "native_tool_file_unbound"))
            continue
        file_id, embedded_key = identity
        try:
            stored = lookup_file(tenant_id, file_id)
        except Exception as exc:
            logger.warning("DOCX metadata lookup unavailable (reason=%s)", type(exc).__name__)
            results.append(FileAcceptance("unverified", "tool_file_lookup_unavailable"))
            continue
        if (
            stored is None
            or stored.id != file_id
            or stored.tenant_id != tenant_id
            or not stored.file_key.startswith(f"tools/{tenant_id}/")
            or ".." in stored.file_key.split("/")
            or (embedded_key is not None and embedded_key != stored.file_key)
        ):
            results.append(FileAcceptance("unverified", "tool_file_identity_unbound"))
            continue
        if stored.size > max_file_bytes:
            results.append(FileAcceptance("unverified", "docx_file_limit"))
            continue
        try:
            stream = load_stream(stored.file_key)
            data = bytearray()
            exceeded = False
            try:
                for chunk in stream:
                    if not isinstance(chunk, bytes):
                        raise ValueError("Storage did not return bytes")
                    if len(data) + len(chunk) > max_file_bytes:
                        exceeded = True
                        break
                    data.extend(chunk)
            finally:
                close = getattr(stream, "close", None)
                if callable(close):
                    close()
        except Exception as exc:
            logger.warning("DOCX storage read unavailable (reason=%s)", type(exc).__name__)
            results.append(FileAcceptance("unverified", "tool_file_bytes_unavailable"))
            continue
        if exceeded:
            results.append(FileAcceptance("unverified", "docx_file_limit"))
        elif stored.size >= 0 and stored.size != len(data):
            results.append(FileAcceptance("unverified", "tool_file_size_unbound"))
        else:
            result = _package_evidence(bytes(data), max_uncompressed_bytes=max_uncompressed_bytes)
            if result.state == "passed":
                return result
            results.append(result)
    return next((result for result in results if result.state == "unverified"), results[0])


def lookup_owned_tool_file(tenant_id: str, file_id: str) -> StoredToolFile | None:
    """Existing database owner scoped by the complete available ToolFile tenant chain."""
    from core.db.session_factory import session_factory
    from models.tools import ToolFile

    with session_factory.create_session() as session:
        row = session.scalar(select(ToolFile).where(ToolFile.id == file_id, ToolFile.tenant_id == tenant_id).limit(1))
        if row is None:
            return None
        return StoredToolFile(id=str(row.id), tenant_id=row.tenant_id, file_key=row.file_key, size=row.size)


def native_docx_evaluator(*, tenant_id: str, run: Run, native_graph: Graph) -> Callable[[object], FileAcceptance]:
    """Bind trusted run/tenant metadata; storage reads occur only for file checks."""
    from extensions.ext_storage import storage

    def evaluate(value: object) -> FileAcceptance:
        return validate_native_docx(
            value,
            tenant_id=tenant_id,
            run=run,
            native_graph=native_graph,
            lookup_file=lookup_owned_tool_file,
            load_stream=storage.load_stream,
        )

    return evaluate
