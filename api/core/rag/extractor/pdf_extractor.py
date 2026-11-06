"""Abstract interface for document loader implementations."""

import contextlib
import hashlib
import io
import logging
import uuid
from collections.abc import Iterator
from typing import TypedDict, override

import pypdfium2
import pypdfium2.raw as pdfium_c
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.extractor.blob.blob import Blob
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile

logger = logging.getLogger(__name__)


class _PdfImageCandidate(TypedDict):
    image_bytes: bytes
    image_ext: str
    mime_type: str
    content_hash: str
    file_key: str


class PdfExtractor(BaseExtractor):
    """
    PdfExtractor is used to extract text and images from PDF files.

    Args:
        file_path: Path to the PDF file.
        tenant_id: Workspace ID.
        user_id: ID of the user performing the extraction.
        file_cache_key: Optional cache key for the extracted text.
        source_file_id: Optional id of the source upload file. When provided,
            extracted images are persisted under deterministic storage keys so
            repeated extractions of the same source reuse the same assets.
        session: Session used to persist extracted images.
    """

    # Magic bytes for image format detection: (magic_bytes, extension, mime_type)
    IMAGE_FORMATS: tuple[tuple[bytes, str, str], ...] = (
        (b"\xff\xd8\xff", "jpg", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
        (b"\x00\x00\x00\x0c\x6a\x50\x20\x20\x0d\x0a\x87\x0a", "jp2", "image/jp2"),
        (b"GIF8", "gif", "image/gif"),
        (b"BM", "bmp", "image/bmp"),
        (b"II*\x00", "tiff", "image/tiff"),
        (b"MM\x00*", "tiff", "image/tiff"),
        (b"II+\x00", "tiff", "image/tiff"),
        (b"MM\x00+", "tiff", "image/tiff"),
    )
    MAX_MAGIC_LEN = max(len(m) for m, _, _ in IMAGE_FORMATS)
    _session: Session | None
    _source_file_id: str | None

    def __init__(
        self,
        file_path: str,
        tenant_id: str | None = None,
        user_id: str | None = None,
        file_cache_key: str | None = None,
        source_file_id: str | None = None,
        *,
        session: Session | None = None,
    ):
        """Initialize PdfExtractor."""
        self._file_path = file_path
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._file_cache_key = file_cache_key
        self._source_file_id = source_file_id
        self._session = session

    @override
    def extract(self) -> list[Document]:
        plaintext_file_exists = False
        if self._file_cache_key:
            with contextlib.suppress(FileNotFoundError):
                text = storage.load(self._file_cache_key).decode("utf-8")
                plaintext_file_exists = True
                return [Document(page_content=text)]
        documents = list(self.load())
        text_list = []
        for document in documents:
            text_list.append(document.page_content)
        text = "\n\n".join(text_list)

        # save plaintext file for caching
        if not plaintext_file_exists and self._file_cache_key:
            storage.save(self._file_cache_key, text.encode("utf-8"))

        return documents

    def load(
        self,
    ) -> Iterator[Document]:
        """Lazy load given path as pages."""
        blob = Blob.from_path(self._file_path)
        yield from self.parse(blob)

    def parse(self, blob: Blob) -> Iterator[Document]:
        """Lazily parse the blob."""

        with blob.as_bytes_io() as file_path:
            pdf_reader = pypdfium2.PdfDocument(file_path, autoclose=True)
            try:
                for page_number, page in enumerate(pdf_reader):
                    text_page = page.get_textpage()
                    content = text_page.get_text_range()
                    text_page.close()

                    image_content = self._extract_images(page, page_number)
                    if image_content:
                        content += "\n" + image_content

                    page.close()
                    metadata = {"source": blob.source, "page": page_number}
                    yield Document(page_content=content, metadata=metadata)
            finally:
                pdf_reader.close()

    def _extract_images(self, page, page_number: int = 0) -> str:
        """
        Extract images from a PDF page, save them to storage and database,
        and return markdown image links.

        When a source file id is available, images are persisted under
        deterministic keys derived from the source upload file, page, object
        index, and content hash so repeated extractions of the same unchanged
        source reuse the existing UploadFile rows and storage objects instead
        of accumulating duplicates.

        Args:
            page: pypdfium2 page object.
            page_number: Zero-based index of the page within the PDF.

        Returns:
            Markdown string containing links to the extracted images.
        """
        if not self._tenant_id or not self._user_id:
            # No tenant context (e.g. file loaded from a URL rather than an
            # uploaded file): extracted images cannot be persisted, so skip
            # image extraction and return text only.
            return ""

        base_url = dify_config.FILES_URL
        candidates: list[_PdfImageCandidate] = []

        try:
            image_objects = page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,))
            for obj_index, obj in enumerate(image_objects):
                try:
                    # Extract image bytes
                    img_byte_arr = io.BytesIO()
                    # Extract DCTDecode (JPEG) and JPXDecode (JPEG 2000) images directly
                    # Fallback to png for other formats
                    obj.extract(img_byte_arr, fb_format="png")
                    img_bytes = img_byte_arr.getvalue()

                    if not img_bytes:
                        continue

                    header = img_bytes[: self.MAX_MAGIC_LEN]
                    image_ext = None
                    mime_type = None
                    for magic, ext, mime in self.IMAGE_FORMATS:
                        if header.startswith(magic):
                            image_ext = ext
                            mime_type = mime
                            break

                    if not image_ext or not mime_type:
                        continue

                    content_hash = hashlib.sha256(img_bytes).hexdigest()
                    if self._source_file_id:
                        # Deterministic key so retried or repeated extractions
                        # reuse the same assets (mirrors ExcelExtractor).
                        file_key = (
                            f"image_files/{self._tenant_id}/{self._source_file_id}/"
                            f"p{page_number}_{obj_index}_{content_hash}.{image_ext}"
                        )
                    else:
                        # Without a source upload file id there is no stable
                        # identity to deduplicate against; keep unique keys.
                        file_key = f"image_files/{self._tenant_id}/{uuid.uuid4()}.{image_ext}"

                    candidates.append(
                        _PdfImageCandidate(
                            image_bytes=img_bytes,
                            image_ext=image_ext,
                            mime_type=mime_type,
                            content_hash=content_hash,
                            file_key=file_key,
                        )
                    )
                except Exception as e:
                    logger.warning("Failed to extract image from PDF: %s", e)
                    continue
        except Exception as e:
            logger.warning("Failed to get objects from PDF page: %s", e)

        if not candidates:
            return ""

        session = self._session or db.session

        upload_files_by_key: dict[str, UploadFile] = {}
        if self._source_file_id:
            existing_upload_files = session.scalars(
                select(UploadFile).where(
                    UploadFile.tenant_id == self._tenant_id,
                    UploadFile.key.in_([candidate["file_key"] for candidate in candidates]),
                )
            ).all()
            upload_files_by_key = {upload_file.key: upload_file for upload_file in existing_upload_files}

        image_content = []
        new_upload_files: list[UploadFile] = []
        for candidate in candidates:
            upload_file = upload_files_by_key.get(candidate["file_key"])
            if upload_file is None:
                try:
                    storage.save(candidate["file_key"], candidate["image_bytes"])
                except Exception as e:
                    logger.warning("Failed to persist extracted PDF image: %s", e)
                    continue
                upload_file = UploadFile(
                    tenant_id=self._tenant_id,
                    storage_type=StorageType(dify_config.STORAGE_TYPE),
                    key=candidate["file_key"],
                    name=candidate["file_key"],
                    size=len(candidate["image_bytes"]),
                    extension=candidate["image_ext"],
                    mime_type=candidate["mime_type"],
                    created_by=self._user_id,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_at=naive_utc_now(),
                    used=True,
                    used_by=self._user_id,
                    used_at=naive_utc_now(),
                    hash=candidate["content_hash"],
                )
                upload_files_by_key[candidate["file_key"]] = upload_file
                new_upload_files.append(upload_file)
            image_content.append(f"![image]({base_url}/files/{upload_file.id}/file-preview)")

        if new_upload_files:
            session.add_all(new_upload_files)
            if self._session is None:
                session.commit()
        return "\n".join(image_content)
