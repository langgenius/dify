"""Abstract interface for document loader implementations."""
import datetime
import mimetypes
import uuid
from typing import Optional

from flask import current_app

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.pdf.openparse import DocumentParser, processing
from core.rag.extractor.pdf.openparse.schemas import ImageElement
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import UploadFile


class PdfExtractor(BaseExtractor):
    """Load pdf files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
            self,
            file_path: str,
            tenant_id: str,
            user_id: str,
            file_cache_key: Optional[str] = None
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._file_cache_key = file_cache_key
        self.tenant_id = tenant_id,
        self.user_id = user_id

    def extract(self) -> list[Document]:
        plaintext_file_key = ''
        plaintext_file_exists = False
        if self._file_cache_key:
            try:
                text = storage.load(self._file_cache_key).decode('utf-8')
                plaintext_file_exists = True
                return [Document(page_content=text)]
            except FileNotFoundError:
                pass
        documents = self.parse()
        text_list = []
        for document in documents:
            text_list.append(document.page_content)
        text = "\n\n".join(text_list)

        # save plaintext file for caching
        if not plaintext_file_exists and plaintext_file_key:
            storage.save(plaintext_file_key, text.encode('utf-8'))

        return documents

    # def load(
    #         self,
    # ) -> list[Document]:
    #     """Lazy load given path as pages."""
    #     blob = Blob.from_path(self._file_path)
    #     yield from self.parse(blob)

    def parse(self) -> list[Document]:
        """Lazily parse the blob."""
        documents = []
        custom_pipeline = processing.BasicIngestionPipeline()

        parser = DocumentParser(
            processing_pipeline=custom_pipeline,
            table_args={
                "parsing_algorithm": "pdfmimer",
                "table_output_format": "markdown"
            }
        )
        parsed_basic_doc = parser.parse(self._file_path, max_parser_page=None)
        documentContent = ''
        last_page_index = 0
        for _index, node in enumerate(parsed_basic_doc.nodes):
            last_page_index = _index
            for element in node.elements:
                if isinstance(element, ImageElement):
                    if isinstance(self.tenant_id,tuple):
                        self.tenant_id = self.tenant_id[0]
                    file_uuid = str(uuid.uuid4())
                    file_key = f'image_files/{self.tenant_id}/{file_uuid}.{element.ext}'
                    mime_type, _ = mimetypes.guess_type(file_key)

                    storage.save(file_key, element.image)
                    # save file to db
                    config = current_app.config
                    upload_file = UploadFile(
                        tenant_id=self.tenant_id,
                        storage_type=config['STORAGE_TYPE'],
                        key=file_key,
                        name=file_key,
                        size=0,
                        extension=element.ext,
                        mime_type=mime_type,
                        created_by=self.user_id,
                        created_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                        used=True,
                        used_by=self.user_id,
                        used_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                    )

                    db.session.add(upload_file)
                    db.session.commit()
                    image_url = f"![image]({current_app.config.get('CONSOLE_API_URL')}/files/{upload_file.id}/image-preview)"
                    documentContent += image_url
                    if element.ocr_context:
                        for box in element.ocr_context:
                            if box.get("type") == "ocr_table":
                                documentContent += box.get("text")
                            elif box.get("type") == "ocr":
                                documentContent += box.get("text")
                else:
                    documentContent += element.text
        documents.append(
            Document(page_content=documentContent, metadata={"source": self._file_path, "page": last_page_index}))
        return documents
