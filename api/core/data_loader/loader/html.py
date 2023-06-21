import logging
from typing import List

from bs4 import BeautifulSoup
from langchain.document_loaders.base import BaseLoader
from langchain.schema import Document

logger = logging.getLogger(__name__)


class HTMLLoader(BaseLoader):
    """Load html files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
        self,
        file_path: str
    ):
        """Initialize with file path."""
        self._file_path = file_path

    def load(self) -> List[Document]:
        return [Document(page_content=self._load_as_text())]

    def _load_as_text(self) -> str:
        with open(self._file_path, "rb") as fp:
            soup = BeautifulSoup(fp, 'html.parser')
            text = soup.get_text()
            text = text.strip() if text else ''

        return text
