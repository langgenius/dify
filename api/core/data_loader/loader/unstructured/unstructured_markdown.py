import logging

from langchain.document_loaders.base import BaseLoader
from langchain.schema import Document

logger = logging.getLogger(__name__)


class UnstructuredMarkdownLoader(BaseLoader):
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

    def __init__(
        self,
        file_path: str,
        api_url: str,
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._api_url = api_url

    def load(self) -> list[Document]:
        from unstructured.partition.md import partition_md

        elements = partition_md(filename=self._file_path, api_url=self._api_url)
        from unstructured.chunking.title import chunk_by_title
        chunks = chunk_by_title(elements, max_characters=2000, combine_text_under_n_chars=0)
        documents = []
        for chunk in chunks:
            text = chunk.text.strip()
            documents.append(Document(page_content=text))

        return documents
