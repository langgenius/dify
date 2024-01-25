"""Loads word documents."""
import os
import tempfile
from typing import List
from urllib.parse import urlparse
import requests
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


class DocExtractor(BaseExtractor):
    """Loads a DOCX with docx2txt
    """

    def __init__(self, file_path: str):
        """Initialize with file path."""
        self.file_path = file_path
        if "~" in self.file_path:
            self.file_path = os.path.expanduser(self.file_path)

        # If the file is a web path, download it to a temporary file, and use that
        if not os.path.isfile(self.file_path) and self._is_valid_url(self.file_path):
            r = requests.get(self.file_path)

            if r.status_code != 200:
                raise ValueError(
                    "Check the url of your file; returned status code %s"
                    % r.status_code
                )

            self.web_path = self.file_path
            self.temp_file = tempfile.NamedTemporaryFile()
            self.temp_file.write(r.content)
            self.file_path = self.temp_file.name
        elif not os.path.isfile(self.file_path):
            raise ValueError("File path %s is not a valid file or url" % self.file_path)

    def __del__(self) -> None:
        if hasattr(self, "temp_file"):
            self.temp_file.close()

    def extract(self) -> List[Document]:
        """Load given path as single page."""
        import docx2txt

        return [
            Document(
                page_content=docx2txt.process(self.file_path),
                metadata={"source": self.file_path},
            )
        ]
    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Check if the url is valid."""
        parsed = urlparse(url)
        return bool(parsed.netloc) and bool(parsed.scheme)



class UnstructuredWordDocumentLoader(BaseExtractor):
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
