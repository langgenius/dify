"""Abstract interface for document loader implementations."""
from typing import Optional

import pandas as pd

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
        """ Load from Excel file in xls or xlsx format using Pandas."""
        data = []
        # Read each worksheet of an Excel file using Pandas
        xls = pd.ExcelFile(self._file_path)
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name)

            # filter out rows with all NaN values
            df.dropna(how='all', inplace=True)

            # transform each row into a Document
            data += [Document(page_content=';'.join(f'"{k}":"{v}"' for k, v in row.items() if pd.notna(v)),
                              metadata={'source': self._file_path})
                     for _, row in df.iterrows()]

        return data

    @staticmethod
    def is_blank_row(row):
        """

        Determine whether the specified line is a blank line.
        :param row: row object。
        :return: Returns True if the row is blank, False otherwise.
        """
        # Iterates through the cells and returns False if a non-empty cell is found
        for cell in row:
            if cell.value is not None and cell.value != '':
                return False
        return True
