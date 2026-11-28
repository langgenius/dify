from io import BytesIO
from pathlib import Path

import pandas as pd
import pytest
from openpyxl import Workbook, load_workbook
from openpyxl.drawing.image import Image as WorksheetImage
from openpyxl.worksheet.worksheet import Worksheet
from PIL import Image
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session

import core.rag.extractor.excel_extractor as excel_module
from core.rag.extractor.excel_extractor import ExcelExtractor
from models.model import UploadFile
from tests.helpers.unit.config_override import apply_config_overrides


def _workbook_with_rows(*rows: tuple[str | int | None, ...]) -> tuple[Workbook, Worksheet]:
    """Create an in-memory workbook with the supplied rows on its first sheet."""
    workbook = Workbook()
    sheet = workbook.active
    assert isinstance(sheet, Worksheet)
    sheet.title = "Data"
    for row in rows:
        sheet.append(row)
    return workbook, sheet


def _png_bytes() -> bytes:
    """Generate a valid small PNG for embedding in the workbook."""
    with BytesIO() as buffer, Image.new("RGB", (2, 2), color="blue") as image:
        image.save(buffer, format="PNG")
        return buffer.getvalue()


def _add_png(sheet: Worksheet, data: bytes, anchor: str) -> None:
    """Attach a fresh image at the supplied cell; saving consumes its byte stream."""
    sheet.add_image(WorksheetImage(BytesIO(data)), anchor)


def _patch_image_persistence(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, bytes]]:
    saves: list[tuple[str, bytes]] = []

    def save(key: str, data: bytes) -> None:
        saves.append((key, data))

    monkeypatch.setattr(excel_module.storage, "save", save)
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local", STORAGE_TYPE="local")

    return saves


def _get_upload_files(session: Session) -> list[UploadFile]:
    """Read the UploadFile rows the extractor committed through the shared factory."""

    return list(session.scalars(select(UploadFile)).all())


class TestExcelExtractor:
    def test_extract_xlsx_with_hyperlinks_and_sheet_skip(self, tmp_path: Path, mocker: MockerFixture) -> None:
        workbook, sheet = _workbook_with_rows(("Name", "Link"), ("Alice", "Doc"), (None, 123))
        sheet["B2"].hyperlink = "https://example.com/doc"
        sheet["A4"].number_format = "@"
        workbook.create_sheet("Empty")
        path = tmp_path / "sample.xlsx"
        workbook.save(path)
        close = mocker.spy(Workbook, "close")

        docs = ExcelExtractor(str(path)).extract()

        close.assert_called_once()
        assert len(docs) == 2
        assert docs[0].page_content == '"Name":"Alice";"Link":"[Doc](https://example.com/doc)"'
        assert docs[1].page_content == '"Name":"";"Link":"123"'
        assert all(doc.metadata["source"] == str(path) for doc in docs)

    def test_extract_xlsx_turns_embedded_images_into_markdown_links(
        self,
        tmp_path: Path,
        mocker: MockerFixture,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        image_bytes = _png_bytes()
        workbook, sheet = _workbook_with_rows(("Question", "Answer", "Image"), ("Q1", "A1"), ("Q2", "A2"))
        _add_png(sheet, image_bytes, "C2")
        _add_png(sheet, image_bytes, "C2")
        path = tmp_path / "sample.xlsx"
        workbook.save(path)
        close = mocker.spy(Workbook, "close")
        saves = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            str(path),
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        docs = extractor.extract()
        upload_files = _get_upload_files(sqlite_session)

        close.assert_called_once()
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
        tmp_path: Path,
        mocker: MockerFixture,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        image_bytes = _png_bytes()
        workbook, sheet = _workbook_with_rows(("Question", "Answer", "Image"))
        # Drawings alone do not increase the worksheet's cell-based row range.
        sheet["C2"].number_format = "@"
        _add_png(sheet, image_bytes, "C2")
        path = tmp_path / "sample.xlsx"
        workbook.save(path)
        readback = load_workbook(path, data_only=True)
        try:
            assert readback["Data"].max_row == 2
            assert readback["Data"]["C2"].value is None
        finally:
            readback.close()
        close = mocker.spy(Workbook, "close")
        saves = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            str(path),
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        docs = extractor.extract()
        upload_files = _get_upload_files(sqlite_session)

        close.assert_called_once()
        assert len(docs) == 1
        assert len(upload_files) == 1
        assert docs[0].page_content == (
            f'"Question":"";"Answer":"";"Image":"![image](http://files.local/files/{upload_files[0].id}/file-preview)"'
        )
        assert len(saves) == 1

    def test_extract_xlsx_reuses_existing_embedded_image_uploads_on_retry(
        self,
        tmp_path: Path,
        mocker: MockerFixture,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        image_bytes = _png_bytes()
        workbook, sheet = _workbook_with_rows(("Question", "Answer", "Image"), ("Q1", "A1"))
        _add_png(sheet, image_bytes, "C2")
        path = tmp_path / "sample.xlsx"
        workbook.save(path)
        close = mocker.spy(Workbook, "close")
        saves = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            str(path),
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        first_docs = extractor.extract()
        second_docs = extractor.extract()
        assert close.call_count == 2
        upload_files = _get_upload_files(sqlite_session)
        assert len(upload_files) == 1

        expected_page_content = (
            '"Question":"Q1";"Answer":"A1";'
            f'"Image":"![image](http://files.local/files/{upload_files[0].id}/file-preview)"'
        )

        assert first_docs[0].page_content == expected_page_content
        assert second_docs[0].page_content == expected_page_content
        assert len(saves) == 1

    def test_extract_xls_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class FakeExcelFile:
            sheet_names = ["Sheet1"]

            def parse(self, sheet_name: str) -> pd.DataFrame:
                assert sheet_name == "Sheet1"
                return pd.DataFrame([{"A": "x", "B": 1}, {"A": None, "B": None}])

        monkeypatch.setattr(pd, "ExcelFile", lambda path, engine=None: FakeExcelFile())

        extractor = ExcelExtractor("/tmp/sample.xls")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == '"A":"x";"B":"1.0"'
        assert docs[0].metadata == {"source": "/tmp/sample.xls"}

    def test_extract_xls_escapes_double_quotes_like_xlsx(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class FakeExcelFile:
            sheet_names = ["Sheet1"]

            def parse(self, sheet_name: str) -> pd.DataFrame:
                return pd.DataFrame([{"note": 'he said "hi"', "plain": "text"}])

        monkeypatch.setattr(pd, "ExcelFile", lambda path, engine=None: FakeExcelFile())

        extractor = ExcelExtractor("/tmp/sample.xls")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == '"note":"he said \\"hi\\"";"plain":"text"'

    def test_extract_unsupported_extension_raises(self) -> None:
        extractor = ExcelExtractor("/tmp/sample.txt")

        with pytest.raises(ValueError, match="Unsupported file extension"):
            extractor.extract()

    def test_find_header_and_columns_prefers_first_row_with_two_columns(self) -> None:
        _, sheet = _workbook_with_rows((None, None, None), ("A", "B", None), ("X", None, None))
        extractor = ExcelExtractor("dummy.xlsx")

        header_row_idx, column_map, max_col_idx = extractor._find_header_and_columns(sheet)

        assert header_row_idx == 2
        assert column_map == {0: "A", 1: "B"}
        assert max_col_idx == 2

    def test_find_header_and_columns_fallback_and_empty_case(self) -> None:
        extractor = ExcelExtractor("dummy.xlsx")

        _, fallback_sheet = _workbook_with_rows(("Only", None), (None, "Second"))
        row_idx, column_map, max_col_idx = extractor._find_header_and_columns(fallback_sheet)
        assert row_idx == 1
        assert column_map == {0: "Only"}
        assert max_col_idx == 1

        _, empty_sheet = _workbook_with_rows()
        assert extractor._find_header_and_columns(empty_sheet) == (0, {}, 0)
