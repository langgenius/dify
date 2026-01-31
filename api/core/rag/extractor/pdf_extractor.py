"""Abstract interface for document loader implementations."""

import contextlib
import io
import logging
import uuid
from collections.abc import Iterator

import pypdfium2
import pypdfium2.raw as pdfium_c

from configs import dify_config
from core.rag.extractor.blob.blob import Blob
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile

logger = logging.getLogger(__name__)


class PdfExtractor(BaseExtractor):
    """
    PdfExtractor is used to extract text and images from PDF files.

    Args:
        file_path: Path to the PDF file.
        tenant_id: Workspace ID.
        user_id: ID of the user performing the extraction.
        file_cache_key: Optional cache key for the extracted text.
    """

    # Magic bytes for image format detection: (magic_bytes, extension, mime_type)
    IMAGE_FORMATS = [
        (b"\xff\xd8\xff", "jpg", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
        (b"\x00\x00\x00\x0c\x6a\x50\x20\x20\x0d\x0a\x87\x0a", "jp2", "image/jp2"),
        (b"GIF8", "gif", "image/gif"),
        (b"BM", "bmp", "image/bmp"),
        (b"II*\x00", "tiff", "image/tiff"),
        (b"MM\x00*", "tiff", "image/tiff"),
        (b"II+\x00", "tiff", "image/tiff"),
        (b"MM\x00+", "tiff", "image/tiff"),
    ]
    MAX_MAGIC_LEN = max(len(m) for m, _, _ in IMAGE_FORMATS)

    def __init__(self, file_path: str, tenant_id: str, user_id: str, file_cache_key: str | None = None):
        """Initialize PdfExtractor."""
        self._file_path = file_path
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._file_cache_key = file_cache_key

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

                    image_content = self._extract_images(page)
                    if image_content:
                        content += "\n" + image_content

                    page.close()
                    metadata = {"source": blob.source, "page": page_number}
                    yield Document(page_content=content, metadata=metadata)
            finally:
                pdf_reader.close()

    def _extract_images(self, page) -> str:
        """
        Extract images from a PDF page, save them to storage and database,
        and return markdown image links.

        Args:
            page: pypdfium2 page object.

        Returns:
            Markdown string containing links to the extracted images.
        """
        image_content = []
        upload_files = []
        base_url = dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL

        try:
            image_objects = page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,))
            for obj in image_objects:
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

                    file_uuid = str(uuid.uuid4())
                    file_key = "image_files/" + self._tenant_id + "/" + file_uuid + "." + image_ext

                    storage.save(file_key, img_bytes)

                    # save file to db
                    upload_file = UploadFile(
                        tenant_id=self._tenant_id,
                        storage_type=dify_config.STORAGE_TYPE,
                        key=file_key,
                        name=file_key,
                        size=len(img_bytes),
                        extension=image_ext,
                        mime_type=mime_type,
                        created_by=self._user_id,
                        created_by_role=CreatorUserRole.ACCOUNT,
                        created_at=naive_utc_now(),
                        used=True,
                        used_by=self._user_id,
                        used_at=naive_utc_now(),
                    )
                    upload_files.append(upload_file)
                    image_content.append(f"![image]({base_url}/files/{upload_file.id}/file-preview)")
                except Exception as e:
                    logger.warning("Failed to extract image from PDF: %s", e)
                    continue
        except Exception as e:
            logger.warning("Failed to get objects from PDF page: %s", e)
        if upload_files:
            db.session.add_all(upload_files)
            db.session.commit()
        return "\n".join(image_content)
