"""Abstract interface for document loader implementations."""

import csv

import pandas as pd

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
        encoding: str | None = None,
        autodetect_encoding: bool = False,
        source_column: str | None = None,
        csv_args: dict | None = None,
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding
        self.source_column = source_column
        self.csv_args = csv_args or {}

    def extract(self) -> list[Document]:
        """Load data into document objects."""
        docs = []
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
        try:
            # load csv file into pandas dataframe
            df = pd.read_csv(csvfile, on_bad_lines="skip", **self.csv_args)

            # check source column exists
            if self.source_column and self.source_column not in df.columns:
                raise ValueError(f"Source column '{self.source_column}' not found in CSV file.")

            # create document objects

            for i, row in df.iterrows():
                content = ";".join(f"{col.strip()}: {str(row[col]).strip()}" for col in df.columns)
                source = row[self.source_column] if self.source_column else ""
                metadata = {"source": source, "row": i}
                doc = Document(page_content=content, metadata=metadata)
                docs.append(doc)
        except csv.Error as e:
            raise e

        return docs
