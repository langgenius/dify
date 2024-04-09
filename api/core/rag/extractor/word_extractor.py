"""Abstract interface for document loader implementations."""
import os
import tempfile
from urllib.parse import urlparse

import requests

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


class WordExtractor(BaseExtractor):
    """Load docx files.


    Args:
        file_path: Path to the file to load.
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

    def extract(self) -> list[Document]:
        """Load given path as single page."""
        from docx import Document as docx_Document

        document = docx_Document(self.file_path)
        doc_texts = [paragraph.text for paragraph in document.paragraphs]
        content = '\n'.join(doc_texts)

        return [Document(
            page_content=content,
            metadata={"source": self.file_path},
        )]

    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Check if the url is valid."""
        parsed = urlparse(url)
        return bool(parsed.netloc) and bool(parsed.scheme)
