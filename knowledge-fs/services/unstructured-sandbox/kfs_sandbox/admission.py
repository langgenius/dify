"""Shared attachment/archive budget, executed only inside the disposable request worker.

This is admission, not a replacement parser. The original provider receives the unchanged
request after admission. Untrusted content is never interpreted as executable instructions.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from email import policy
from email.message import Message
from email.parser import BytesParser
from pathlib import PurePosixPath
from typing import Callable, Iterable
from xml.parsers import expat


class Rejected(Exception):
    """Stable safe error: no document text, local path, or attachment name in diagnostics."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Limits:
    depth: int = 8
    attachments: int = 128
    mime_parts: int = 1024
    decoded_bytes: int = 128 * 1024 * 1024
    archive_entries: int = 4096
    expanded_bytes: int = 512 * 1024 * 1024
    xml_bytes: int = 64 * 1024 * 1024
    xml_member_bytes: int = 16 * 1024 * 1024
    xml_depth: int = 128
    xml_nodes: int = 1_000_000
    sheets: int = 256
    sheet_rows: int = 100_000
    sheet_columns: int = 16_384
    sheet_cells: int = 250_000
    workbook_cells: int = 500_000


@dataclass
class Budget:
    limits: Limits = Limits()
    attachments: int = 0
    mime_parts: int = 0
    decoded_bytes: int = 0
    archive_entries: int = 0
    expanded_bytes: int = 0
    xml_bytes: int = 0
    xml_nodes: int = 0
    sheets: int = 0
    workbook_cells: int = 0

    def consume(self, key: str, amount: int = 1) -> None:
        value = getattr(self, key) + amount
        if value > getattr(self.limits, key):
            raise Rejected(key)
        setattr(self, key, value)


ATTACHMENT_EXTENSIONS = frozenset(
    "pdf doc docx ppt pptx xls xlsx rtf odt epub eml msg md markdown mdx txt text "
    "properties vtt html htm csv xml png jpg jpeg gif webp bmp tif tiff heic".split()
)
ARCHIVE_EXTENSIONS = frozenset({"docx", "pptx", "xlsx", "epub", "odt"})
_CELL = re.compile(r"\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})\Z")
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
MsgLoader = Callable[[bytes], Iterable[tuple[str, bytes]]]


def _msg_attachments(body: bytes) -> Iterable[tuple[str, bytes]]:
    # Public API used by the pinned Unstructured 0.22.18 MSG partitioner itself.
    from oxmsg import Message as OutlookMessage

    for attachment in OutlookMessage.load(io.BytesIO(body)).attachments:
        yield attachment.file_name or "unknown", attachment.file_bytes or b""


def _is_outlook_storage(body: bytes) -> bool:
    import olefile

    try:
        with olefile.OleFileIO(io.BytesIO(body)) as storage:
            return storage.exists("__properties_version1.0")
    except (OSError, ValueError) as error:
        raise Rejected("ole_invalid") from error


def inspect_document(
    body: bytes,
    filename: str,
    budget: Budget | None = None,
    *,
    depth: int = 0,
    msg_loader: MsgLoader = _msg_attachments,
) -> Budget:
    budget = budget or Budget()
    if depth > budget.limits.depth:
        raise Rejected("depth")
    suffix = filename.rsplit(".", 1)[-1].lower()
    if body.startswith(b"PK\x03\x04") or suffix in ARCHIVE_EXTENSIONS:
        _inspect_archive(body, budget)
    elif suffix == "msg" or (body.startswith(_OLE) and _is_outlook_storage(body)):
        try:
            for name, data in msg_loader(body):
                _inspect_attachment(data, name, budget, depth + 1, msg_loader)
        except Rejected:
            raise
        except Exception as error:
            raise Rejected("msg_invalid") from error
    elif suffix == "eml" or _looks_like_mail(body):
        try:
            message = BytesParser(policy=policy.default).parsebytes(body)
            _inspect_message(message, budget, depth, msg_loader)
        except Rejected:
            raise
        except (ValueError, RecursionError) as error:
            raise Rejected("mime_invalid") from error
    return budget


def _looks_like_mail(body: bytes) -> bool:
    headers = body[:8192].split(b"\r\n\r\n", 1)[0].split(b"\n\n", 1)[0].lower()
    return b"mime-version:" in headers and (
        b"from:" in headers or b"subject:" in headers
    )


def _inspect_attachment(
    body: bytes, filename: str, budget: Budget, depth: int, loader: MsgLoader
) -> None:
    budget.consume("attachments")
    budget.consume("decoded_bytes", len(body))
    suffix = filename.rsplit(".", 1)[-1].lower()
    if suffix not in ATTACHMENT_EXTENSIONS:
        raise Rejected("unsupported_attachment")
    inspect_document(body, filename, budget, depth=depth, msg_loader=loader)


def _inspect_message(
    message: Message, budget: Budget, depth: int, loader: MsgLoader
) -> None:
    pending = [(message, depth)]
    while pending:
        part, part_depth = pending.pop()
        if part_depth > budget.limits.depth:
            raise Rejected("depth")
        budget.consume("mime_parts")
        if part.defects:
            raise Rejected("mime_invalid")
        if part.get_content_type() == "message/rfc822":
            budget.consume("attachments")
            payload = part.get_payload()
            if not isinstance(payload, list):
                raise Rejected("mime_invalid")
            for nested in payload:
                # RFC822 attachments are Message objects, not decoded byte payloads.
                budget.consume(
                    "decoded_bytes", len(nested.as_bytes(policy=policy.default))
                )
                pending.append((nested, part_depth + 1))
        elif part.is_multipart():
            pending.extend(
                (child, part_depth + 1) for child in reversed(part.get_payload())
            )
        elif part.get_filename() or part.get_content_disposition() == "attachment":
            data = part.get_payload(decode=True)
            if data is None or part.defects:
                raise Rejected("mime_invalid")
            _inspect_attachment(
                data, part.get_filename() or "unknown", budget, part_depth + 1, loader
            )


def _inspect_archive(body: bytes, budget: Budget) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            infos = archive.infolist()
            if budget.archive_entries + len(infos) > budget.limits.archive_entries:
                raise Rejected("archive_entries")
            if (
                budget.expanded_bytes + sum(info.file_size for info in infos)
                > budget.limits.expanded_bytes
            ):
                raise Rejected("expanded_bytes")
            names: set[str] = set()
            for info in infos:
                name = info.filename.replace("\\", "/")
                if (
                    name in names
                    or name.startswith("/")
                    or ".." in PurePosixPath(name).parts
                    or ":" in name
                ):
                    raise Rejected("archive_path")
                names.add(name)
                budget.consume("archive_entries")
                if info.flag_bits & 1:
                    raise Rejected("archive_encrypted")
                xml = name.lower().endswith((".xml", ".rels", ".xhtml", ".opf", ".ncx"))
                guard = _XmlGuard(budget) if xml else None
                member_bytes = 0
                with archive.open(info) as member:
                    while chunk := member.read(64 * 1024):
                        budget.consume("expanded_bytes", len(chunk))
                        member_bytes += len(chunk)
                        if guard:
                            budget.consume("xml_bytes", len(chunk))
                            if member_bytes > budget.limits.xml_member_bytes:
                                raise Rejected("xml_member_bytes")
                            guard.feed(chunk)
                    if guard:
                        guard.finish()
    except Rejected:
        raise
    except (
        zipfile.BadZipFile,
        NotImplementedError,
        RuntimeError,
        expat.ExpatError,
        ValueError,
    ) as error:
        raise Rejected("archive_invalid") from error


class _XmlGuard:
    def __init__(self, budget: Budget):
        self.budget = budget
        self.depth = 0
        self.rows = 0
        self.columns = 0
        self.worksheet = False
        self.current_row = 0
        self.current_column = 0
        self.parser = expat.ParserCreate(namespace_separator="}")
        self.parser.StartElementHandler = self._start
        self.parser.EndElementHandler = self._end
        self.parser.EntityDeclHandler = self._entity
        self.parser.ExternalEntityRefHandler = self._entity

    @staticmethod
    def _entity(*_args):
        raise Rejected("xml_entity")

    def _start(self, name: str, attrs: dict[str, str]) -> None:
        self.depth += 1
        if self.depth > self.budget.limits.xml_depth:
            raise Rejected("xml_depth")
        self.budget.consume("xml_nodes")
        local = name.rsplit("}", 1)[-1]
        if local == "worksheet":
            self.worksheet = True
            self.budget.consume("sheets")
        if self.worksheet and local == "row":
            row = attrs.get("r", str(self.current_row + 1))
            if (
                not row.isascii()
                or not row.isdigit()
                or not 0 < int(row) <= self.budget.limits.sheet_rows
            ):
                raise Rejected("sheet_extent")
            self.current_row = int(row)
            self.current_column = 0
        if self.worksheet and local in {"c", "mergeCell"}:
            reference = attrs.get("r" if local == "c" else "ref", "")
            if local == "c" and not reference:
                self.current_column += 1
                self._cell(max(1, self.current_row), self.current_column)
                return
            for cell in reference.split(":"):
                match = _CELL.fullmatch(cell)
                if not match:
                    raise Rejected("sheet_cell_reference")
                column = 0
                for letter in match[1].upper():
                    column = column * 26 + ord(letter) - ord("A") + 1
                row = int(match[2])
                if local == "c":
                    self.current_column = column
                self._cell(row, column)

    def _cell(self, row: int, column: int) -> None:
        if (
            row > self.budget.limits.sheet_rows
            or column > self.budget.limits.sheet_columns
        ):
            raise Rejected("sheet_extent")
        previous = self.rows * self.columns
        self.rows, self.columns = max(self.rows, row), max(self.columns, column)
        if self.rows * self.columns > self.budget.limits.sheet_cells:
            raise Rejected("sheet_cells")
        self.budget.consume("workbook_cells", self.rows * self.columns - previous)

    def _end(self, _name: str) -> None:
        self.depth -= 1

    def feed(self, chunk: bytes) -> None:
        self.parser.Parse(chunk, False)

    def finish(self) -> None:
        self.parser.Parse(b"", True)
