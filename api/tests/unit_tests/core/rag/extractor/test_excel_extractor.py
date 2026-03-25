from types import SimpleNamespace

import pandas as pd
import pytest

import core.rag.extractor.excel_extractor as excel_module
from core.rag.extractor.excel_extractor import ExcelExtractor


class _FakeCell:
    def __init__(self, value, hyperlink=None, number_format=None):
        self.value = value
        self.hyperlink = hyperlink
        self.number_format = number_format


class _FakeSheet:
    def __init__(self, header_rows, data_rows):
        self._header_rows = header_rows
        self._data_rows = data_rows

    def iter_rows(self, min_row=1, max_row=None, max_col=None, values_only=False):
        if values_only:
            for row in self._header_rows:
                yield tuple(row)
            return

        for row in self._data_rows:
            if max_col is not None:
                yield tuple(row[:max_col])
            else:
                yield tuple(row)


class _FakeWorkbook:
    def __init__(self, sheets):
        self._sheets = sheets
        self.sheetnames = list(sheets.keys())
        self.closed = False

    def __getitem__(self, key):
        return self._sheets[key]

    def close(self):
        self.closed = True


class TestExcelExtractor:
    def test_extract_xlsx_with_hyperlinks_and_sheet_skip(self, monkeypatch):
        sheet_with_data = _FakeSheet(
            header_rows=[("Name", "Link")],
            data_rows=[
                (_FakeCell("Alice"), _FakeCell("Doc", hyperlink=SimpleNamespace(target="https://example.com/doc"))),
                (_FakeCell(None), _FakeCell(123)),
                (_FakeCell(None), _FakeCell(None)),
            ],
        )
        empty_sheet = _FakeSheet(header_rows=[(None, None)], data_rows=[])

        workbook = _FakeWorkbook({"Data": sheet_with_data, "Empty": empty_sheet})
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbook)

        extractor = ExcelExtractor("/tmp/sample.xlsx")
        docs = extractor.extract()

        assert workbook.closed is True
        assert len(docs) == 2
        assert docs[0].page_content == '"Name":"Alice";"Link":"[Doc](https://example.com/doc)"'
        assert docs[1].page_content == '"Name":"";"Link":"123"'
        assert all(doc.metadata["source"] == "/tmp/sample.xlsx" for doc in docs)

    def test_extract_xls_path(self, monkeypatch):
        class FakeExcelFile:
            sheet_names = ["Sheet1"]

            def parse(self, sheet_name):
                assert sheet_name == "Sheet1"
                return pd.DataFrame([{"A": "x", "B": 1}, {"A": None, "B": None}])

        monkeypatch.setattr(pd, "ExcelFile", lambda path, engine=None: FakeExcelFile())

        extractor = ExcelExtractor("/tmp/sample.xls")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == '"A":"x";"B":"1.0"'
        assert docs[0].metadata == {"source": "/tmp/sample.xls"}

    def test_extract_unsupported_extension_raises(self):
        extractor = ExcelExtractor("/tmp/sample.txt")

        with pytest.raises(ValueError, match="Unsupported file extension"):
            extractor.extract()

    def test_find_header_and_columns_prefers_first_row_with_two_columns(self):
        sheet = _FakeSheet(
            header_rows=[(None, None, None), ("A", "B", None), ("X", None, None)],
            data_rows=[],
        )
        extractor = ExcelExtractor("dummy.xlsx")

        header_row_idx, column_map, max_col_idx = extractor._find_header_and_columns(sheet)

        assert header_row_idx == 2
        assert column_map == {0: "A", 1: "B"}
        assert max_col_idx == 2

    def test_find_header_and_columns_fallback_and_empty_case(self):
        extractor = ExcelExtractor("dummy.xlsx")

        fallback_sheet = _FakeSheet(header_rows=[("Only", None), (None, "Second")], data_rows=[])
        row_idx, column_map, max_col_idx = extractor._find_header_and_columns(fallback_sheet)
        assert row_idx == 1
        assert column_map == {0: "Only"}
        assert max_col_idx == 1

        empty_sheet = _FakeSheet(header_rows=[(None, None)], data_rows=[])
        assert extractor._find_header_and_columns(empty_sheet) == (0, {}, 0)

    def test_extract_xlsx_preserves_percentage_formatting(self, monkeypatch):
        """Test that percentage-formatted cells are extracted as percentages, not decimals."""
        sheet = _FakeSheet(
            header_rows=[("Item", "Score")],
            data_rows=[
                (_FakeCell("Test A"), _FakeCell(0.9, number_format="0%")),
                (_FakeCell("Test B"), _FakeCell(0.456, number_format="0%")),
                (_FakeCell("Test C"), _FakeCell(0.456, number_format="0.0%")),
                (_FakeCell("Test D"), _FakeCell(0.12345, number_format="0.00%")),
                (_FakeCell("Test E"), _FakeCell(123.45, number_format="General")),
                (_FakeCell("Test Hash 1"), _FakeCell(0.9, number_format="0.#%")),
                (_FakeCell("Test Hash 2"), _FakeCell(0.912, number_format="0.##%")),
            ],
        )

        workbook = _FakeWorkbook({"Sheet1": sheet})
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbook)

        extractor = ExcelExtractor("/tmp/test.xlsx")
        docs = extractor.extract()

        assert len(docs) == 7
        # 0.9 with 0% format should become 90%
        assert '"Score":"90%"' in docs[0].page_content
        assert "0.9" not in docs[0].page_content
        # 0.456 with 0% format should round to 46% (not 45.6%)
        assert '"Score":"46%"' in docs[1].page_content
        assert "0.456" not in docs[1].page_content
        assert "45.6%" not in docs[1].page_content
        # 0.456 with 0.0% format should become 45.6%
        assert '"Score":"45.6%"' in docs[2].page_content
        # 0.12345 with 0.00% format should become 12.35% (rounded)
        assert '"Score":"12.35%"' in docs[3].page_content
        # Regular number without percentage format should remain as-is
        assert '"Score":"123.45"' in docs[4].page_content
        # 0.9 with 0.#% format should become 90% (trailing zero stripped)
        assert '"Score":"90%"' in docs[5].page_content
        # 0.912 with 0.##% format should become 91.2% (one trailing zero stripped)
        assert '"Score":"91.2%"' in docs[6].page_content
