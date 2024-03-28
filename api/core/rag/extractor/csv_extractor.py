"""Abstract interface for document loader implementations."""
import csv
from typing import Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.helpers import detect_file_encodings
from core.rag.models.document import Document


class CSVExtractor(BaseExtractor):
    """Load CSV files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
            self,
            file_path: str,
            encoding: Optional[str] = None,
            autodetect_encoding: bool = False,
            source_column: Optional[str] = None,
            csv_args: Optional[dict] = None,
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding
        self.source_column = source_column
        self.csv_args = csv_args or {}

    def extract(self) -> list[Document]:
        """Load data into document objects."""
        try:
            with open(self._file_path, newline="", encoding=self._encoding) as csvfile:
                docs = self._read_from_file(csvfile)
        except UnicodeDecodeError as e:
            if self._autodetect_encoding:
                detected_encodings = detect_file_encodings(self._file_path)
                for encoding in detected_encodings:
                    try:
                        with open(self._file_path, newline="", encoding=encoding.encoding) as csvfile:
                            docs = self._read_from_file(csvfile)
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                raise RuntimeError(f"Error loading {self._file_path}") from e

        return docs

    def _read_from_file(self, csvfile) -> list[Document]:
        docs = []
        csv_reader = csv.DictReader(csvfile, **self.csv_args)  # type: ignore
        for i, row in enumerate(csv_reader):
            content = "\n".join(f"{k.strip()}: {v.strip()}" for k, v in row.items())
            try:
                source = (
                    row[self.source_column]
                    if self.source_column is not None
                    else ''
                )
            except KeyError:
                raise ValueError(
                    f"Source column '{self.source_column}' not found in CSV file."
                )
            metadata = {"source": source, "row": i}
            doc = Document(page_content=content, metadata=metadata)
            docs.append(doc)

        return docs
