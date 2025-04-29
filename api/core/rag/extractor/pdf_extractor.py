"""Enhanced PDF document loader with improved features for text extraction and structure analysis."""
import uuid
from collections.abc import Iterator
from typing import Optional, cast
import mimetypes
import pdfplumber
import pytesseract
from PIL import Image
import io
import datetime

from configs import dify_config
from core.rag.extractor.blob.blob import Blob
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.enums import CreatedByRole
from models.model import UploadFile

class PdfExtractor(BaseExtractor):
    """Enhanced PDF loader with improved text extraction, OCR support, and structure analysis.

    Args:
        file_path: Path to the PDF file to load.
        file_cache_key: Optional cache key for storing extracted text.
        enable_ocr: Whether to enable OCR for text extraction from images.
    """

    def __init__(self, file_path: str, file_cache_key: Optional[str] = None, enable_ocr: bool = False, tenant_id: str = None, user_id: str = None):
        """Initialize with file path and optional settings."""
        self._file_path = file_path
        self._file_cache_key = file_cache_key
        self._enable_ocr = enable_ocr
        self._tenant_id = tenant_id
        self._user_id = user_id

    def extract(self) -> list[Document]:
        """Extract text from PDF with caching support."""
        plaintext_file_exists = False
        if self._file_cache_key:
            try:
                text = cast(bytes, storage.load(self._file_cache_key)).decode("utf-8")
                plaintext_file_exists = True
                return [Document(page_content=text)]
            except FileNotFoundError:
                pass

        documents = list(self.load())
        text_list = []
        for document in documents:
            text_list.append(document.page_content)
        text = "\n\n".join(text_list)

        # Save plaintext file for caching
        if not plaintext_file_exists and self._file_cache_key:
            storage.save(self._file_cache_key, text.encode("utf-8"))

        return documents

    def load(self) -> Iterator[Document]:
        """Lazy load PDF pages with enhanced text extraction."""
        blob = Blob.from_path(self._file_path)
        yield from self.parse(blob)

    def parse(self, blob: Blob) -> Iterator[Document]:
        """Parse PDF with enhanced features including OCR and structure analysis."""
        with blob.as_bytes_io() as file_obj:
            with pdfplumber.open(file_obj) as pdf:
                for page_number, page in enumerate(pdf.pages):
                    # Extract text with layout preservation and encoding detection
                    content = page.extract_text(layout=True)
                    # Try to detect and fix encoding issues
                    try:
                        # First try to decode as UTF-8
                        content = content.encode('utf-8').decode('utf-8')
                    except UnicodeError:
                        try:
                            # If UTF-8 fails, try GB18030 (common Chinese encoding)
                            content = content.encode('utf-8').decode('gb18030', errors='ignore')
                        except UnicodeError:
                            # If all else fails, use a more lenient approach
                            content = content.encode('utf-8', errors='ignore').decode('utf-8', errors='ignore')

                    # Extract tables if present
                    tables = page.extract_tables()
                    if tables:
                        table_text = ""
                        for table in tables:
                            # Convert table to text format
                            table_text +="\n".join(
                                ["\t".join([str(cell) if cell else "" for cell in row])
                                 for row in table]
                            )
                        content += table_text

                    # Extract images if present
                    images = page.images
                    if images:
                        image_text = ""
                        for i, img in enumerate(images):
                            # Generate a unique filename for the image
                            file_uuid = str(uuid.uuid4())
                            image_ext = "png"
                            file_key = f"image_files/{self._tenant_id}/{file_uuid}.{image_ext}"
                            mime_type, _ = mimetypes.guess_type(file_key)

                            # Save image to storage
                            image_bytes = io.BytesIO(img['stream'].get_data())
                            image_data = image_bytes.getvalue()
                            storage.save(file_key, image_data)

                            # Save file record to database
                            if self._tenant_id and self._user_id:
                                upload_file = UploadFile(
                                    tenant_id=self._tenant_id,
                                    storage_type=dify_config.STORAGE_TYPE,
                                    key=file_key,
                                    name=file_key,
                                    size=len(image_data),
                                    extension=image_ext,
                                    mime_type=mime_type or "",
                                    created_by=self._user_id,
                                    created_by_role=CreatedByRole.ACCOUNT,
                                    created_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                                    used=True,
                                    used_by=self._user_id,
                                    used_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                                )

                                db.session.add(upload_file)
                                db.session.commit()

                                # Add image preview URL to content
                                image_text += f"![image]({dify_config.CONSOLE_API_URL}/files/{upload_file.id}/file-preview) "
                        content += image_text

                    # Perform OCR if enabled and text content is limited or contains potential encoding issues
                    if self._enable_ocr and (len(content.strip()) < 100 or any('\ufffd' in line for line in content.splitlines())):
                        image = page.to_image()
                        img_bytes = io.BytesIO()
                        image.original.save(img_bytes, format='PNG')
                        img_bytes.seek(0)
                        pil_image = Image.open(img_bytes)
                        # Use multiple language models and improve OCR accuracy
                        ocr_text = pytesseract.image_to_string(
                            pil_image,
                            lang='chi_sim+chi_tra+eng',  # Support both simplified and traditional Chinese
                            config='--psm 3 --oem 3'  # Use more accurate OCR mode
                        )
                        if ocr_text.strip():
                            # Clean and normalize OCR text
                            ocr_text = ocr_text.replace('\x0c', '').strip()
                            content = f"{content}\n\nOCR Text:\n{ocr_text}"

                    metadata = {
                        "source": blob.source,
                        "page": page_number,
                        "has_tables": bool(tables)
                    }

                    yield Document(page_content=content, metadata=metadata)