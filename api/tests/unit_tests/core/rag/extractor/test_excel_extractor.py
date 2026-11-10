import logging
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

import core.rag.extractor.excel_extractor as excel_module
from core.rag.extractor.excel_extractor import ExcelExtractor
from models.base import TypeBase
from models.model import UploadFile
from tests.helpers.unit.config_override import apply_config_overrides


@pytest.fixture
def database_session_maker(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> sessionmaker[Session]:
    TypeBase.metadata.create_all(sqlite_engine, tables=[UploadFile.__table__])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(excel_module.session_factory, "create_session", session_maker)
    return session_maker


class _FakeCell:
    def __init__(self, value, hyperlink=None):
        self.value = value
        self.hyperlink = hyperlink
        self.row = 0
        self.column = 0


class _FakeSheet:
    def __init__(self, header_rows, data_rows, images=None):
        self._header_rows = header_rows
        self._data_rows = data_rows
        self._images = images or []

    def iter_rows(self, min_row=1, max_row=None, max_col=None, values_only=False):
        if values_only:
            for row in self._header_rows:
                yield tuple(row)
            return

        for row_idx, row in enumerate(self._data_rows, start=min_row):
            materialized_row = tuple(row[:max_col] if max_col is not None else row)
            for col_idx, cell in enumerate(materialized_row, start=1):
                cell.row = row_idx
                cell.column = col_idx
            yield materialized_row


class _FakeWorkbook:
    def __init__(self, sheets):
        self._sheets = sheets
        self.sheetnames = list(sheets.keys())
        self.closed = False

    def __getitem__(self, key):
        return self._sheets[key]

    def close(self):
        self.closed = True


class _FakeImage:
    def __init__(self, data: bytes, row: int, col: int, image_format: str = "png"):
        self._raw_data = data
        self.anchor = SimpleNamespace(_from=SimpleNamespace(row=row, col=col))
        self.format = image_format

    def _data(self) -> bytes:
        return self._raw_data


def _patch_image_persistence(monkeypatch: pytest.MonkeyPatch):
    saves: list[tuple[str, bytes]] = []

    def save(key: str, data: bytes) -> None:
        saves.append((key, data))

    monkeypatch.setattr(excel_module.storage, "save", save)
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local", STORAGE_TYPE="local")

    return saves


def _get_upload_files(session_maker: sessionmaker[Session]) -> list[UploadFile]:
    with session_maker() as session:
        return list(session.scalars(select(UploadFile)).all())


class TestExcelExtractor:
    def test_extract_xlsx_with_hyperlinks_and_sheet_skip(self, monkeypatch: pytest.MonkeyPatch):
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

    def test_extract_xlsx_turns_embedded_images_into_markdown_links(
        self,
        monkeypatch: pytest.MonkeyPatch,
        database_session_maker: sessionmaker[Session],
    ):
        image_bytes = b"\x89PNG\r\n\x1a\nexcel-image"
        sheet = _FakeSheet(
            header_rows=[("Question", "Answer", "Image")],
            data_rows=[
                (_FakeCell("Q1"), _FakeCell("A1"), _FakeCell(None)),
                (_FakeCell("Q2"), _FakeCell("A2"), _FakeCell(None)),
            ],
            images=[
                _FakeImage(image_bytes, row=1, col=2),
                _FakeImage(image_bytes, row=1, col=2),
            ],
        )
        workbook = _FakeWorkbook({"Data": sheet})
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbook)
        saves = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            "/tmp/sample.xlsx",
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        docs = extractor.extract()
        upload_files = _get_upload_files(database_session_maker)

        assert workbook.closed is True
        assert len(docs) == 2
        assert len(upload_files) == 1
        assert docs[0].page_content == (
            '"Question":"Q1";"Answer":"A1";'
            f'"Image":"![image](http://files.local/files/{upload_files[0].id}/file-preview) '
            f'![image](http://files.local/files/{upload_files[0].id}/file-preview)"'
        )
        assert docs[1].page_content == '"Question":"Q2";"Answer":"A2";"Image":""'
        assert len(saves) == 1
        assert saves[0][0].startswith("image_files/tenant-1/source-file-1/")
        assert saves[0][0].endswith(".png")
        assert saves[0][1] == image_bytes
        assert upload_files[0].tenant_id == "tenant-1"
        assert upload_files[0].key == saves[0][0]
        assert upload_files[0].used is True

    def test_extract_xlsx_keeps_rows_with_only_embedded_images(
        self,
        monkeypatch: pytest.MonkeyPatch,
        database_session_maker: sessionmaker[Session],
    ):
        image_bytes = b"\x89PNG\r\n\x1a\nimage-only-row"
        sheet = _FakeSheet(
            header_rows=[("Question", "Answer", "Image")],
            data_rows=[
                (_FakeCell(None), _FakeCell(None), _FakeCell(None)),
                (_FakeCell(None), _FakeCell(None), _FakeCell(None)),
            ],
            images=[_FakeImage(image_bytes, row=1, col=2)],
        )
        workbook = _FakeWorkbook({"Data": sheet})
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbook)
        saves = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            "/tmp/sample.xlsx",
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        docs = extractor.extract()
        upload_files = _get_upload_files(database_session_maker)

        assert workbook.closed is True
        assert len(docs) == 1
        assert len(upload_files) == 1
        assert docs[0].page_content == (
            f'"Question":"";"Answer":"";"Image":"![image](http://files.local/files/{upload_files[0].id}/file-preview)"'
        )
        assert len(saves) == 1

    def test_extract_xlsx_reuses_existing_embedded_image_uploads_on_retry(
        self,
        monkeypatch: pytest.MonkeyPatch,
        database_session_maker: sessionmaker[Session],
    ):
        image_bytes = b"\x89PNG\r\n\x1a\nretry-safe-image"
        workbooks = [
            _FakeWorkbook(
                {
                    "Data": _FakeSheet(
                        header_rows=[("Question", "Answer", "Image")],
                        data_rows=[(_FakeCell("Q1"), _FakeCell("A1"), _FakeCell(None))],
                        images=[_FakeImage(image_bytes, row=1, col=2)],
                    )
                }
            ),
            _FakeWorkbook(
                {
                    "Data": _FakeSheet(
                        header_rows=[("Question", "Answer", "Image")],
                        data_rows=[(_FakeCell("Q1"), _FakeCell("A1"), _FakeCell(None))],
                        images=[_FakeImage(image_bytes, row=1, col=2)],
                    )
                }
            ),
        ]
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbooks.pop(0))
        saves = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            "/tmp/sample.xlsx",
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        first_docs = extractor.extract()
        second_docs = extractor.extract()
        upload_files = _get_upload_files(database_session_maker)
        assert len(upload_files) == 1

        expected_page_content = (
            '"Question":"Q1";"Answer":"A1";'
            f'"Image":"![image](http://files.local/files/{upload_files[0].id}/file-preview)"'
        )

        assert first_docs[0].page_content == expected_page_content
        assert second_docs[0].page_content == expected_page_content
        assert len(saves) == 1

    def test_extract_xls_path(self, monkeypatch: pytest.MonkeyPatch):
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

    def test_extract_xls_escapes_double_quotes_like_xlsx(self, monkeypatch: pytest.MonkeyPatch):
        class FakeExcelFile:
            sheet_names = ["Sheet1"]

            def parse(self, sheet_name):
                return pd.DataFrame([{"note": 'he said "hi"', "plain": "text"}])

        monkeypatch.setattr(pd, "ExcelFile", lambda path, engine=None: FakeExcelFile())

        extractor = ExcelExtractor("/tmp/sample.xls")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == '"note":"he said \\"hi\\"";"plain":"text"'

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

    def test_extract_xlsx_finds_a_header_below_the_first_ten_rows(self, tmp_path):
        """A title and spacer rows must not hide the table.

        Business spreadsheets commonly put a report title, a logo or blank
        rows above the table. Scanning only the first ten rows found no
        header there and the whole sheet was dropped without a log.
        """
        from openpyxl import Workbook

        path = tmp_path / "late_header.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        assert sheet is not None
        sheet.cell(row=1, column=1, value="Quarterly Sales Report")
        for column, name in enumerate(["Region", "Revenue", "Units"], start=1):
            sheet.cell(row=12, column=column, value=name)
        for column, value in enumerate(["APAC", 4200, 42], start=1):
            sheet.cell(row=13, column=column, value=value)
        for column, value in enumerate(["EMEA", 3100, 31], start=1):
            sheet.cell(row=14, column=column, value=value)
        workbook.save(path)

        documents = ExcelExtractor(str(path)).extract()
        text = "\n".join(document.page_content for document in documents)

        assert documents, "the sheet must not be dropped"
        for value in ("APAC", "EMEA", "4200", "3100", "42", "31"):
            assert value in text

    def test_extract_xlsx_keeps_every_column_of_a_late_header(self, tmp_path):
        """The header row must bring its whole column map with it.

        When only a single-cell title row was in range the fallback picked
        that row as the header, so every column past the first was skipped
        and their values never reached the index.
        """
        from openpyxl import Workbook

        path = tmp_path / "late_header_columns.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        assert sheet is not None
        for column, name in enumerate(["Region", "Revenue", "Units"], start=1):
            sheet.cell(row=11, column=column, value=name)
        for column, value in enumerate(["APAC", 4200, 42], start=1):
            sheet.cell(row=12, column=column, value=value)
        workbook.save(path)

        documents = ExcelExtractor(str(path)).extract()
        text = "\n".join(document.page_content for document in documents)

        assert "Revenue" in text
        assert "4200" in text
        assert "Units" in text
        assert "42" in text

    def test_sheet_without_a_header_row_is_reported(self, tmp_path, caplog) -> None:
        """A populated sheet that yields no header must leave a trace.

        The workbook has its only value at row 101, past the header scan
        window, so no header is found. An empty sheet is the control: it is
        expected to produce nothing and must stay quiet.
        """
        from openpyxl import Workbook

        populated_path = tmp_path / "too_late.xlsx"
        populated_book = Workbook()
        populated_sheet = populated_book.active
        assert populated_sheet is not None
        populated_sheet.cell(row=101, column=1, value="only value")
        populated_book.save(populated_path)

        with caplog.at_level(logging.WARNING, logger=excel_module.__name__):
            documents = ExcelExtractor(str(populated_path)).extract()

        assert documents == []
        assert "No header row found in sheet" in caplog.text
        assert populated_book.active.title in caplog.text

        empty_path = tmp_path / "empty.xlsx"
        Workbook().save(empty_path)
        caplog.clear()

        with caplog.at_level(logging.WARNING, logger=excel_module.__name__):
            empty_documents = ExcelExtractor(str(empty_path)).extract()

        assert empty_documents == []
        assert "No header row found in sheet" not in caplog.text

    def test_extract_warns_when_a_populated_sheet_has_no_header(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        """A sheet dropped for lack of a header must not vanish silently."""
        sheet = _FakeSheet(header_rows=[("Some value",)], data_rows=[])
        workbook = _FakeWorkbook({"Sheet1": sheet})

        monkeypatch.setattr(excel_module, "load_workbook", lambda *a, **k: workbook)
        monkeypatch.setattr(excel_module.ExcelExtractor, "_find_header_and_columns", lambda self, s: (0, {}, 0))

        with caplog.at_level(logging.WARNING, logger=excel_module.__name__):
            documents = ExcelExtractor("book.xlsx").extract()

        assert documents == []
        assert "No header row found in sheet" in caplog.text
        assert "Sheet1" in caplog.text

    def test_extract_xlsx_keeps_columns_under_a_merged_header(self, tmp_path):
        """A header merged across columns must not hide the covered column.

        openpyxl stores a merged header's text in its leftmost cell and
        reports the covered cells as None, so the covered columns used to be
        left out of the column map and their values never reached the text.
        """
        from openpyxl import Workbook

        path = tmp_path / "merged_header.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        assert sheet is not None
        sheet["A1"] = "Customer"
        sheet["B1"] = "Contact"
        sheet.merge_cells("B1:C1")
        sheet["D1"] = "Phone"
        for column, value in enumerate(["Acme", "Jane", "Doe", "555-0100"], start=1):
            sheet.cell(row=2, column=column, value=value)
        workbook.save(path)

        documents = ExcelExtractor(str(path)).extract()
        text = "\n".join(document.page_content for document in documents)

        assert "Acme" in text
        assert "Jane" in text
        assert "Doe" in text, "the covered column's value must survive"
        assert "555-0100" in text

    def test_merged_header_names_stay_distinguishable(self, tmp_path):
        """Reusing one name for every covered column would be ambiguous."""
        from openpyxl import Workbook

        path = tmp_path / "merged_header_names.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        assert sheet is not None
        sheet["A1"] = "Group"
        sheet["B1"] = "Value"
        sheet.merge_cells("B1:D1")
        for column, value in enumerate(["g1", "v1", "v2", "v3"], start=1):
            sheet.cell(row=2, column=column, value=value)
        workbook.save(path)

        documents = ExcelExtractor(str(path)).extract()
        text = "\n".join(document.page_content for document in documents)

        assert '"Value":"v1"' in text
        assert '"Value_2":"v2"' in text
        assert '"Value_3":"v3"' in text

    def test_vertically_merged_header_is_not_extended_to_siblings(self):
        """A row-spanning merge is a section title, not a multi-column header."""
        extractor = ExcelExtractor("dummy.xlsx")

        class _Range:
            min_row = 1
            max_row = 3
            min_col = 2
            max_col = 2

        class _Merged:
            ranges = [_Range()]

        class _Sheet:
            merged_cells = _Merged()

            def cell(self, row, column):
                return SimpleNamespace(value="Section")

        assert extractor._merged_spans_by_row(_Sheet()) == {}
