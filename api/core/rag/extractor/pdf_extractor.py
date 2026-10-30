"""Abstract interface for document loader implementations."""

import io
import logging
from collections.abc import Iterator
from typing import override

import pypdfium2
import pypdfium2.raw as pdfium_c

from core.rag.extractor.blob.blob import Blob
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from services.extraction.contracts import ExtractedImage, ImageWriter

logger = logging.getLogger(__name__)


class _ImageWriteError(RuntimeError):
    """Keep caller-owned image writer failures out of parser best-effort handling."""


class PdfExtractor(BaseExtractor):
    """
    PdfExtractor is used to extract text and images from PDF files.

    Args:
        file_path: Path to the PDF file.
        image_writer: Optional caller-owned image persistence operation.
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
    _image_writer: ImageWriter | None

    def __init__(
        self,
        file_path: str,
        *,
        image_writer: ImageWriter | None = None,
    ):
        """Initialize PdfExtractor."""
        self._file_path = file_path
        self._image_writer = image_writer

    @override
    def extract(self) -> list[Document]:
        return list(self.load())

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
                    try:
                        text_page = page.get_textpage()
                        try:
                            content = text_page.get_text_range()
                        finally:
                            text_page.close()

                        image_content = ""
                        if self._image_writer is not None:
                            image_content = self._extract_images(page, page_number)
                        if image_content:
                            content += "\n" + image_content

                        metadata = {"source": blob.source, "page": page_number}
                        yield Document(page_content=content, metadata=metadata)
                    finally:
                        page.close()
            finally:
                pdf_reader.close()

    def _extract_images(self, page, page_number: int = 0) -> str:
        """
        Extract images from a PDF page and delegate their persistence.

        Each image carries a stable page/object identity. The caller-owned
        writer combines it with the source identity and content hash when it
        can safely reuse a previously published image.

        Args:
            page: pypdfium2 page object.
            page_number: Zero-based index of the page within the PDF.

        Returns:
            Markdown string containing links to the extracted images.
        """
        if self._image_writer is None:
            return ""

        image_content = []

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

                    try:
                        image = ExtractedImage(
                            content=img_bytes,
                            extension=image_ext,
                            mime_type=mime_type,
                            stable_identity=f"p{page_number}_{obj_index}",
                        )
                        preview_url = self._image_writer.write(image).preview_url
                    except Exception as error:
                        raise _ImageWriteError(str(error)) from error
                    image_content.append(f"![image]({preview_url})")
                except _ImageWriteError:
                    raise
                except Exception as e:
                    logger.warning("Failed to extract image from PDF: %s", e)
                    continue
        except _ImageWriteError:
            raise
        except Exception as e:
            logger.warning("Failed to get objects from PDF page: %s", e)
        return "\n".join(image_content)
