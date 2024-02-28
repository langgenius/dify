import logging
import os

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document

logger = logging.getLogger(__name__)


class UnstructuredWordExtractor(BaseExtractor):
    """Loader that uses unstructured to load word documents.
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
        from unstructured.__version__ import __version__ as __unstructured_version__
        from unstructured.file_utils.filetype import FileType, detect_filetype

        unstructured_version = tuple(
            [int(x) for x in __unstructured_version__.split(".")]
        )
        # check the file extension
        try:
            import magic  # noqa: F401

            is_doc = detect_filetype(self._file_path) == FileType.DOC
        except ImportError:
            _, extension = os.path.splitext(str(self._file_path))
            is_doc = extension == ".doc"

        if is_doc and unstructured_version < (0, 4, 11):
            raise ValueError(
                f"You are on unstructured version {__unstructured_version__}. "
                "Partitioning .doc files is only supported in unstructured>=0.4.11. "
                "Please upgrade the unstructured package and try again."
            )

        if is_doc:
            from unstructured.partition.doc import partition_doc

            elements = partition_doc(filename=self._file_path)
        else:
            from unstructured.partition.docx import partition_docx

            elements = partition_docx(filename=self._file_path)

        from unstructured.chunking.title import chunk_by_title
        chunks = chunk_by_title(elements, max_characters=2000, combine_text_under_n_chars=0)
        documents = []
        for chunk in chunks:
            text = chunk.text.strip()
            documents.append(Document(page_content=text))
        return documents
