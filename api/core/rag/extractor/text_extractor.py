"""Abstract interface for document loader implementations."""
from typing import Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.helpers import detect_file_encodings
from core.rag.models.document import Document


class TextExtractor(BaseExtractor):
    """Load text files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
            self,
            file_path: str,
            encoding: Optional[str] = None,
            autodetect_encoding: bool = False
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding

    def extract(self) -> list[Document]:
        """Load from file path."""
        text = ""
        try:
            with open(self._file_path, encoding=self._encoding) as f:
                text = f.read()
        except UnicodeDecodeError as e:
            if self._autodetect_encoding:
                detected_encodings = detect_file_encodings(self._file_path)
                for encoding in detected_encodings:
                    try:
                        with open(self._file_path, encoding=encoding.encoding) as f:
                            text = f.read()
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                raise RuntimeError(f"Error loading {self._file_path}") from e
        except Exception as e:
            raise RuntimeError(f"Error loading {self._file_path}") from e

        metadata = {"source": self._file_path}
        return [Document(page_content=text, metadata=metadata)]
