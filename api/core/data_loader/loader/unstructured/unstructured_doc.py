import base64
import logging
from typing import List

from bs4 import BeautifulSoup

from core.rag.datasource.vdb.vector_base import BaseVector

logger = logging.getLogger(__name__)


class UnstructuredWordExtractor(BaseVector):
    """Loader that uses unstructured to load word documents.
    References
    ----------
    https://unstructured-io.github.io/unstructured/bricks.html#partition-docx
    """

    def _get_elements(self) -> List:
        from unstructured.__version__ import __version__ as __unstructured_version__
        from unstructured.file_utils.filetype import FileType, detect_filetype

        unstructured_version = tuple(
            [int(x) for x in __unstructured_version__.split(".")]
        )
        # NOTE(MthwRobinson) - magic will raise an import error if the libmagic
        # system dependency isn't installed. If it's not installed, we'll just
        # check the file extension
        try:
            import magic  # noqa: F401

            is_doc = detect_filetype(self.file_path) == FileType.DOC
        except ImportError:
            _, extension = os.path.splitext(str(self.file_path))
            is_doc = extension == ".doc"

        if is_doc and unstructured_version < (0, 4, 11):
            raise ValueError(
                f"You are on unstructured version {__unstructured_version__}. "
                "Partitioning .doc files is only supported in unstructured>=0.4.11. "
                "Please upgrade the unstructured package and try again."
            )

        if is_doc:
            from unstructured.partition.doc import partition_doc

            return partition_doc(filename=self.file_path, **self.unstructured_kwargs)
        else:
            from unstructured.partition.docx import partition_docx

            return partition_docx(filename=self.file_path, **self.unstructured_kwargs)