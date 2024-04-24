"""Abstract interface for document loader implementations."""
from typing import Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.pdf.openparse import DocumentParser, processing
from core.rag.extractor.pdf.openparse.schemas import ImageElement
from core.rag.models.document import Document
from extensions.ext_storage import storage


class PdfExtractor(BaseExtractor):
    """Load pdf files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
            self,
            file_path: str,
            file_cache_key: Optional[str] = None
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._file_cache_key = file_cache_key

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
        documents = list(self.load())
        text_list = []
        for document in documents:
            text_list.append(document.page_content)
        text = "\n\n".join(text_list)

        # save plaintext file for caching
        if not plaintext_file_exists and plaintext_file_key:
            storage.save(plaintext_file_key, text.encode('utf-8'))

        return documents

    def load(
            self,
    ) -> list[Document]:
        """Lazy load given path as pages."""
        # blob = Blob.from_path(self._file_path)
        # yield from self.parse(blob)
        documents = []
        parser = DocumentParser(
            processing_pipeline=processing.BasicIngestionPipeline(),
            table_args={
                "parsing_algorithm": "pymupdf",
                "table_output_format": "markdown"
            }
        )
        parsed_basic_doc = parser.parse(self._file_path)
        documentContent = ''
        for _index, node in enumerate(parsed_basic_doc.nodes):
            metadata = {"source": self._file_path, "page": _index}
            for element in node.elements:
                if isinstance(element, ImageElement):
                    # pdf images a
                    pass
                else:
                    documentContent += element.text
                if len(documentContent) > 1500:
                    documents.append(Document(page_content=documentContent, metadata=metadata))
                    documentContent = ''
        documents.append(Document(page_content=documentContent, metadata=metadata))
        return documents

    # def parse(self, blob: Blob) -> Iterator[Document]:
    #     """Lazily parse the blob."""
    #     import pypdfium2
    #
    #     with blob.as_bytes_io() as file_path:
    #         pdf_reader = pypdfium2.PdfDocument(file_path, autoclose=True)
    #         try:
    #             for page_number, page in enumerate(pdf_reader):
    #                 text_page = page.get_textpage()
    #                 content = text_page.get_text_range()
    #                 text_page.close()
    #                 page.close()
    #                 metadata = {"source": blob.source, "page": page_number}
    #                 yield Document(page_content=content, metadata=metadata)
    #         finally:
    #             pdf_reader.close()
