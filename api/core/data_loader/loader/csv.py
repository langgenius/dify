import logging
from typing import Optional, Dict, List

from langchain.document_loaders import CSVLoader as LCCSVLoader
from langchain.document_loaders.helpers import detect_file_encodings

from models.dataset import Document

logger = logging.getLogger(__name__)


class CSVLoader(LCCSVLoader):
    def __init__(
            self,
            file_path: str,
            source_column: Optional[str] = None,
            csv_args: Optional[Dict] = None,
            encoding: Optional[str] = None,
            autodetect_encoding: bool = True,
    ):
        self.file_path = file_path
        self.source_column = source_column
        self.encoding = encoding
        self.csv_args = csv_args or {}
        self.autodetect_encoding = autodetect_encoding

    def load(self) -> List[Document]:
        """Load data into document objects."""
        try:
            with open(self.file_path, newline="", encoding=self.encoding) as csvfile:
                docs = self._read_from_file(csvfile)
        except UnicodeDecodeError as e:
            if self.autodetect_encoding:
                detected_encodings = detect_file_encodings(self.file_path)
                for encoding in detected_encodings:
                    logger.debug("Trying encoding: ", encoding.encoding)
                    try:
                        with open(self.file_path, newline="", encoding=encoding.encoding) as csvfile:
                            docs = self._read_from_file(csvfile)
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                raise RuntimeError(f"Error loading {self.file_path}") from e

        return docs

    def _read_from_file(self, csvfile):
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
