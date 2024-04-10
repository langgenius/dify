"""Abstract interface for document loader implementations."""
from typing import Optional

import pandas as pd
import xlrd

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
        """ parse excel file"""
        if self._file_path.endswith('.xls'):
            return self._extract4xls()
        elif self._file_path.endswith('.xlsx'):
            return self._extract4xlsx()

    def _extract4xls(self) -> list[Document]:
        wb = xlrd.open_workbook(filename=self._file_path)
        row_header = None
        documents = []
        # loop over all sheets
        for sheet in wb.sheets():
            for row_index, row in enumerate(sheet.get_rows(), start=1):
                if self.is_blank_row(row):
                    continue
                if row_header is None:
                    row_header = row
                    continue
                item_arr = []
                for index, cell in enumerate(row):
                    txt_value = str(cell.value)
                    item_arr.append(f'{row_header[index].value}:{txt_value}')
                item_str = "\n".join(item_arr)
                document = Document(page_content=item_str, metadata={'source': self._file_path})
                documents.append(document)
        return documents

    def _extract4xlsx(self) -> list[Document]:
        """Load from file path using Pandas."""
        data = []
        # 使用 Pandas 读取 Excel 文件的每个工作表
        xls = pd.ExcelFile(self._file_path)
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name)

            # filter out rows with all NaN values
            df.dropna(how='all', inplace=True)

            # transform each row into a Document
            for _, row in df.iterrows():
                item = ';'.join(f'{k}:{v}' for k, v in row.items() if pd.notna(v))
                document = Document(page_content=item, metadata={'source': self._file_path})
                data.append(document)
        return data

    @staticmethod
    def is_blank_row(row):
        """
        判断指定行是否为空白行。
        :param row: 行对象。
        :return: 如果行是空白的，则返回True，否则返回False。
        """
        # 遍历单元格，如果发现非空单元格，则返回False
        for cell in row:
            if cell.value is not None and cell.value != '':
                return False
        # 如果所有单元格都是空的，则返回True
        return True
