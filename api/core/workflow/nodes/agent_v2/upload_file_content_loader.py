"""Production :class:`FileContentLoader` backed by ``upload_files`` + storage.

Stage 4 §6: the :class:`FileOutputCheckExecutor` needs to read both the
benchmark file (operator-supplied) and the agent-produced file as text so the
LLM evaluator can compare them. Both are stored in Dify's ``upload_files``
table; this adapter:

1. resolves the ``file_id`` to an ``UploadFile`` row inside the caller's tenant
   (cross-tenant access returns ``None`` — never raises);
2. classifies the file's extension as text-extractable or unsupported (image /
   archive / audio / video / executable are all treated as unsupported until
   the executor learns to feed vision input or downloads);
3. delegates text extraction to :class:`ExtractProcessor.load_from_upload_file`
   so PDFs / Word / CSV / Markdown / HTML / Text all reuse the existing RAG
   pipeline rather than re-implementing decoders.

Any extraction failure (corrupt file, unsupported encoding, ETL backend down)
becomes a ``LoadedFileContent`` with ``unsupported=True`` instead of an
exception so the executor can map it to a deterministic ``SKIPPED`` result.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DataError, SQLAlchemyError

from core.db.session_factory import session_factory
from core.rag.extractor.extract_processor import ExtractProcessor
from models.model import UploadFile

from .output_check_executor import LoadedFileContent

logger = logging.getLogger(__name__)


# File extensions explicitly rejected because text extraction either does not
# apply (images, audio, video) or yields no useful comparison material
# (archives, executables). Anything outside this set falls through to
# ``ExtractProcessor`` which has its own fallback to a text decoder.
_UNSUPPORTED_EXTENSIONS: frozenset[str] = frozenset(
    {
        # Images — handled later by a vision-capable code path; deferred to
        # stage 4.1 per design doc §6.3.
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".bmp",
        ".tiff",
        ".svg",
        ".ico",
        # Audio / video.
        ".mp3",
        ".wav",
        ".ogg",
        ".flac",
        ".mp4",
        ".m4a",
        ".mov",
        ".webm",
        ".avi",
        ".mkv",
        # Archives.
        ".zip",
        ".tar",
        ".gz",
        ".bz2",
        ".7z",
        ".rar",
        # Executables / native binaries.
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".bin",
        ".dmg",
    }
)


class UploadFileContentLoader:
    """Resolve an ``upload_files`` row → extracted plain text content.

    Returns ``None`` (not an exception) for unknown / cross-tenant / DB-error
    cases so the executor can produce a deterministic SKIPPED result. Returns
    a ``LoadedFileContent`` with ``unsupported=True`` when the file format is
    recognized but not text-extractable (e.g. image, archive). Returns a
    populated ``LoadedFileContent`` on success.
    """

    def load(self, *, file_id: str, tenant_id: str) -> LoadedFileContent | None:
        if not file_id or not tenant_id:
            return None
        try:
            UUID(file_id)
        except (ValueError, TypeError):
            return None
        try:
            with session_factory.create_session() as session:
                upload_file = session.scalar(select(UploadFile).where(UploadFile.id == file_id))
        except (DataError, SQLAlchemyError):
            logger.warning("UploadFileContentLoader: DB error while resolving file_id=%s", file_id, exc_info=True)
            return None

        if upload_file is None or upload_file.tenant_id != tenant_id:
            return None

        extension = self._extension_of(upload_file)
        if extension in _UNSUPPORTED_EXTENSIONS:
            return LoadedFileContent(text="", unsupported=True)

        try:
            extracted = ExtractProcessor.load_from_upload_file(upload_file, return_text=True)
        except Exception:
            # Any failure inside the extraction pipeline (corrupt file,
            # missing storage object, ETL backend down, plugin error...) is
            # surfaced as "unsupported" so the executor produces a SKIPPED
            # result rather than failing the whole node.
            logger.warning(
                "UploadFileContentLoader: extraction failed for file_id=%s ext=%s",
                file_id,
                extension,
                exc_info=True,
            )
            return LoadedFileContent(text="", unsupported=True)

        if not isinstance(extracted, str):
            # ExtractProcessor.load_from_upload_file returns ``list[Document]``
            # only when ``return_text=False``; defensive guard.
            return LoadedFileContent(text="", unsupported=True)

        return LoadedFileContent(text=extracted)

    @staticmethod
    def _extension_of(upload_file: UploadFile) -> str:
        """Lowercased ``.ext`` form of :attr:`UploadFile.extension`.

        ``UploadFile.extension`` is stored without the leading dot (e.g.
        ``"pdf"``), but the unsupported-set is keyed by ``".pdf"`` form so
        we normalize before lookup. Empty extension stays empty.
        """
        raw = (upload_file.extension or "").strip().lower()
        if not raw:
            return ""
        return raw if raw.startswith(".") else f".{raw}"
