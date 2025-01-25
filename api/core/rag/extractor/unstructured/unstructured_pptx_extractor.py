import logging
from typing import Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document

logger = logging.getLogger(__name__)


class UnstructuredPPTXExtractor(BaseExtractor):
    """Load pptx files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(self, file_path: str, api_url: Optional[str] = None, api_key: str = ""):
        """Initialize with file path."""
        self._file_path = file_path
        self._api_url = api_url
        self._api_key = api_key

    def extract(self) -> list[Document]:
        if self._api_url:
            from unstructured.partition.api import partition_via_api

            elements = partition_via_api(filename=self._file_path, api_url=self._api_url, api_key=self._api_key)
        else:
            from unstructured.partition.pptx import partition_pptx

            elements = partition_pptx(filename=self._file_path)
        text_by_page: dict[int, str] = {}
        for element in elements:
            page = element.metadata.page_number
            text = element.text
            if page is not None:
                if page in text_by_page:
                    text_by_page[page] += "\n" + text
                else:
                    text_by_page[page] = text

        combined_texts = list(text_by_page.values())
        documents = []
        for combined_text in combined_texts:
            text = combined_text.strip()
            documents.append(Document(page_content=text))

        return documents
