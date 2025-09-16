"""Abstract interface for document loader implementations."""

import os
from typing import Optional, cast

import pandas as pd
from openpyxl import load_workbook

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


def _format_cell_value(value) -> str:
    if pd.isna(value):
        return ""
    
    if isinstance(value, (int, float)):
        if isinstance(value, float):
            if value.is_integer():
                return str(int(value))
            else:
                formatted = f"{value:f}"
                return formatted.rstrip('0').rstrip('.')
        else:
            return str(value)
    
    return str(value)


class ExcelExtractor(BaseExtractor):
    """Load Excel files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(self, file_path: str, encoding: Optional[str] = None, autodetect_encoding: bool = False):
        """Initialize with file path."""
        self._file_path = file_path
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding

    def extract(self) -> list[Document]:
        """Load from Excel file in xls or xlsx format using Pandas and openpyxl."""
        documents = []
        file_extension = os.path.splitext(self._file_path)[-1].lower()

        if file_extension == ".xlsx":
            wb = load_workbook(self._file_path, data_only=True)
            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                data = sheet.values
                cols = next(data, None)
                if cols is None:
                    continue
                df = pd.DataFrame(data, columns=cols)

                df.dropna(how="all", inplace=True)

                for index, row in df.iterrows():
                    page_content = []
                    for col_index, (k, v) in enumerate(row.items()):
                        if pd.notna(v):
                            cell = sheet.cell(
                                row=cast(int, index) + 2, column=col_index + 1
                            )  # +2 to account for header and 1-based index
                            if cell.hyperlink:
                                formatted_v = _format_cell_value(v)
                                value = f"[{formatted_v}]({cell.hyperlink.target})"
                                page_content.append(f'"{k}":"{value}"')
                            else:
                                formatted_v = _format_cell_value(v)
                                page_content.append(f'"{k}":"{formatted_v}"')
                    documents.append(
                        Document(page_content=";".join(page_content), metadata={"source": self._file_path})
                    )

        elif file_extension == ".xls":
            excel_file = pd.ExcelFile(self._file_path, engine="xlrd")
            for excel_sheet_name in excel_file.sheet_names:
                df = excel_file.parse(sheet_name=excel_sheet_name)
                df.dropna(how="all", inplace=True)

                for _, row in df.iterrows():
                    page_content = []
                    for k, v in row.items():
                        if pd.notna(v):
                            formatted_v = _format_cell_value(v)
                            page_content.append(f'"{k}":"{formatted_v}"')
                    documents.append(
                        Document(page_content=";".join(page_content), metadata={"source": self._file_path})
                    )
        else:
            raise ValueError(f"Unsupported file extension: {file_extension}")

        return documents
