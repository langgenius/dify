"""Abstract interface for document loader implementations."""
from typing import Optional

from openpyxl.reader.excel import load_workbook

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


class ExcelExtractor(BaseExtractor):
    """Load Excel files.


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
        data = []
        wb = load_workbook(filename=self._file_path, read_only=True)
        # loop over all sheets
        for sheet in wb:
            keys = []
            if 'A1:A1' == sheet.calculate_dimension():
                sheet.reset_dimensions()
            for row in sheet.iter_rows(values_only=True):
                if all(v is None for v in row):
                    continue
                if keys == []:
                    keys = list(map(str, row))
                else:
                    row_dict = dict(zip(keys, list(map(str, row))))
                    row_dict = {k: v for k, v in row_dict.items() if v}
                    item = ''.join(f'{k}:{v};' for k, v in row_dict.items())
                    document = Document(page_content=item, metadata={'source': self._file_path})
                    data.append(document)

        return data
