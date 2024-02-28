import base64
import logging

from bs4 import BeautifulSoup

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document

logger = logging.getLogger(__name__)


class UnstructuredEmailExtractor(BaseExtractor):
    """Load msg files.
    Args:
        file_path: Path to the file to load.
    """

    def __init__(
        self,
        file_path: str,
        api_url: str,
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._api_url = api_url

    def extract(self) -> list[Document]:
        from unstructured.partition.email import partition_email
        elements = partition_email(filename=self._file_path, api_url=self._api_url)

        # noinspection PyBroadException
        try:
            for element in elements:
                element_text = element.text.strip()

                padding_needed = 4 - len(element_text) % 4
                element_text += '=' * padding_needed

                element_decode = base64.b64decode(element_text)
                soup = BeautifulSoup(element_decode.decode('utf-8'), 'html.parser')
                element.text = soup.get_text()
        except Exception:
            pass

        from unstructured.chunking.title import chunk_by_title
        chunks = chunk_by_title(elements, max_characters=2000, combine_text_under_n_chars=0)
        documents = []
        for chunk in chunks:
            text = chunk.text.strip()
            documents.append(Document(page_content=text))
        return documents
