"""Resolve a Tidy conflict by rewriting one passage of a stored document.

The reviewer picks the statement that is right; the other document's passage is replaced and the
result is uploaded as a new revision of that document. Only content held by the knowledge base
changes: the file the user originally uploaded stays as that revision's source, and a provider
that syncs the document would overwrite the edit, so source-managed documents are refused.

The edit is a plain text substitution, so it is limited to documents whose stored source is text.
It must also be unambiguous: a passage that is missing or occurs more than once is refused rather
than guessed at.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Protocol

from services.knowledge_fs.data_facade import KnowledgeFSDocumentRevisionTarget
from services.knowledge_fs.download_service import KnowledgeFSDownloadService
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentDownloadDescriptor,
    KnowledgeFSLogicalDocumentResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSRemoteMultipartFile

# Stored sources that are text end to end; anything parsed (PDF, Word) would lose its structure.
TIDY_REWRITABLE_MIME_TYPES = frozenset({"text/markdown", "text/x-markdown", "text/plain"})
TIDY_REWRITE_MAX_BYTES = 2 * 1024 * 1024


class KnowledgeFSTidyRewriteError(Exception):
    """A rewrite the reviewer has to resolve another way; ``code`` names the reason for the UI."""

    def __init__(self, code: str, message: str, status: int = HTTPStatus.CONFLICT) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = int(status)


class _DocumentReader(Protocol):
    def get_logical_document(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSLogicalDocumentResponse: ...

    def prepare_logical_document_download(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSDocumentDownloadDescriptor: ...


def prepare_tidy_rewrite(
    *,
    facade: _DocumentReader,
    downloads: KnowledgeFSDownloadService,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    document_id: str,
    passage: str,
    replacement: str,
) -> tuple[KnowledgeFSRemoteMultipartFile, KnowledgeFSDocumentRevisionTarget]:
    """Build the edited source of ``document_id`` and the revision it must replace.

    Raises:
        KnowledgeFSTidyRewriteError: the document cannot be edited this way, is still being
            processed, or the passage cannot be located exactly once.
    """
    document = facade.get_logical_document(
        tenant_id=tenant_id, account_id=account_id, control_space_id=control_space_id, document_id=document_id
    )
    if document.source_id:
        raise KnowledgeFSTidyRewriteError(
            "tidy_rewrite_source_managed", "The document is synced from a source; edit it there."
        )
    active = document.active
    task = document.latest_task
    if (
        document.status != "ready"
        or active is None
        or document.active_revision is None
        or (task is not None and task.state in ("queued", "running"))
    ):
        raise KnowledgeFSTidyRewriteError(
            "tidy_rewrite_document_busy", "The document is still being processed; try again once it is ready."
        )
    mime_type = active.mime_type.partition(";")[0].strip().lower()
    if mime_type not in TIDY_REWRITABLE_MIME_TYPES or active.size_bytes > TIDY_REWRITE_MAX_BYTES:
        raise KnowledgeFSTidyRewriteError(
            "tidy_rewrite_unsupported_document", "Only Markdown and plain-text documents can be rewritten."
        )
    descriptor = facade.prepare_logical_document_download(
        tenant_id=tenant_id, account_id=account_id, control_space_id=control_space_id, document_id=document_id
    )
    body = b"".join(downloads.load_stream(descriptor))
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise KnowledgeFSTidyRewriteError(
            "tidy_rewrite_unsupported_document", "The document is not UTF-8 text."
        ) from exc
    # Evidence is quoted from parsed text, where line breaks are always "\n".
    needle = next(
        (candidate for candidate in (passage, passage.replace("\n", "\r\n")) if candidate and candidate in text),
        None,
    )
    if needle is None:
        raise KnowledgeFSTidyRewriteError(
            "tidy_rewrite_passage_not_found", "The passage is not in the document's stored source."
        )
    if text.count(needle) != 1:
        raise KnowledgeFSTidyRewriteError(
            "tidy_rewrite_passage_ambiguous", "The passage occurs more than once in the document."
        )
    edited = text.replace(needle, replacement.replace("\n", "\r\n") if "\r\n" in needle else replacement)
    if edited == text:
        raise KnowledgeFSTidyRewriteError("tidy_rewrite_no_change", "The replacement equals the current passage.")
    return (
        KnowledgeFSRemoteMultipartFile(
            filename=descriptor.filename,
            content_type=descriptor.mime_type or mime_type,
            body=edited.encode("utf-8"),
        ),
        KnowledgeFSDocumentRevisionTarget(
            document_id=document.id,
            expected_active_revision=document.active_revision,
            expected_row_version=document.row_version,
        ),
    )
