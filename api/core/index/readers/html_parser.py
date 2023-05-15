from pathlib import Path
from typing import Dict

from bs4 import BeautifulSoup
from llama_index.readers.file.base_parser import BaseParser


class HTMLParser(BaseParser):
    """HTML parser."""

    def _init_parser(self) -> Dict:
        """Init parser."""
        return {}

    def parse_file(self, file: Path, errors: str = "ignore") -> str:
        """Parse file."""
        with open(file, "rb") as fp:
            soup = BeautifulSoup(fp, 'html.parser')
            text = soup.get_text()
            text = text.strip() if text else ''

        return text
