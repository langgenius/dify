import logging

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document

logger = logging.getLogger(__name__)


class UnstructuredMarkdownExtractor(BaseExtractor):
    """Load md files.


    Args:
        file_path: Path to the file to load.

        remove_hyperlinks: Whether to remove hyperlinks from the text.

        remove_images: Whether to remove images from the text.

        encoding: File encoding to use. If `None`, the file will be loaded
        with the default system encoding.

        autodetect_encoding: Whether to try to autodetect the file encoding
            if the specified encoding fails.
    """

    def __init__(self, file_path: str, api_url: str, api_key: str):
        """Initialize with file path."""
        self._file_path = file_path
        self._api_url = api_url
        self._api_key = api_key

    def extract(self) -> list[Document]:
        if self._api_url:
            from unstructured.partition.api import partition_via_api

            elements = partition_via_api(filename=self._file_path, api_url=self._api_url, api_key=self._api_key)
        else:
            from unstructured.partition.md import partition_md

            elements = partition_md(filename=self._file_path)
        from unstructured.chunking.title import chunk_by_title

        chunks = chunk_by_title(elements, max_characters=2000, combine_text_under_n_chars=2000)
        documents = []
        for chunk in chunks:
            text = chunk.text.strip()
            documents.append(Document(page_content=text))

        return documents
