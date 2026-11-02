from types import SimpleNamespace

import pandas as pd
import pytest

import core.rag.extractor.excel_extractor as excel_module
from core.rag.extractor.excel_extractor import ExcelExtractor
from services.extraction.contracts import ExtractedImage, ImageReference


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


class _ImageWriter:
    def __init__(self) -> None:
        self.calls: list[ExtractedImage] = []

    def write(self, image: ExtractedImage) -> ImageReference:
        self.calls.append(image)
        return ImageReference(preview_url=f"http://files.local/files/image-{len(self.calls)}/file-preview")


class TestExcelExtractor:
    def test_image_writer_failure_propagates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sheet = _FakeSheet(
            header_rows=[("Question", "Image")],
            data_rows=[(_FakeCell("Q1"), _FakeCell(None))],
            images=[_FakeImage(b"\x89PNG\r\n\x1a\nimage", row=1, col=1)],
        )
        monkeypatch.setattr(excel_module, "load_workbook", lambda *_args, **_kwargs: _FakeWorkbook({"Data": sheet}))

        class FailingWriter:
            def write(self, _image: ExtractedImage) -> ImageReference:
                raise RuntimeError("storage response lost")

        extractor = ExcelExtractor("/tmp/sample.xlsx", image_writer=FailingWriter())

        with pytest.raises(RuntimeError, match="storage response lost"):
            extractor.extract()

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
        writer = _ImageWriter()

        extractor = ExcelExtractor("/tmp/sample.xlsx", image_writer=writer)
        docs = extractor.extract()

        assert workbook.closed is True
        assert len(docs) == 2
        assert docs[0].page_content == (
            '"Question":"Q1";"Answer":"A1";'
            '"Image":"![image](http://files.local/files/image-1/file-preview) '
            '![image](http://files.local/files/image-1/file-preview)"'
        )
        assert docs[1].page_content == '"Question":"Q2";"Answer":"A2";"Image":""'
        assert writer.calls == [ExtractedImage(content=image_bytes, extension="png", mime_type="image/png")]

    def test_extract_xlsx_keeps_rows_with_only_embedded_images(
        self,
        monkeypatch: pytest.MonkeyPatch,
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
        writer = _ImageWriter()

        extractor = ExcelExtractor("/tmp/sample.xlsx", image_writer=writer)
        docs = extractor.extract()

        assert workbook.closed is True
        assert len(docs) == 1
        assert docs[0].page_content == (
            '"Question":"";"Answer":"";"Image":"![image](http://files.local/files/image-1/file-preview)"'
        )
        assert writer.calls == [ExtractedImage(content=image_bytes, extension="png", mime_type="image/png")]

    def test_each_excel_extraction_invokes_writer_for_its_embedded_image(
        self,
        monkeypatch: pytest.MonkeyPatch,
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
        writer = _ImageWriter()

        extractor = ExcelExtractor("/tmp/sample.xlsx", image_writer=writer)
        first_docs = extractor.extract()
        second_docs = extractor.extract()

        assert first_docs[0].page_content != second_docs[0].page_content
        assert writer.calls == [
            ExtractedImage(content=image_bytes, extension="png", mime_type="image/png"),
            ExtractedImage(content=image_bytes, extension="png", mime_type="image/png"),
        ]

    def test_failed_excel_extraction_leaves_cleanup_to_the_image_writer_owner(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        class FailingSheet(_FakeSheet):
            def iter_rows(self, min_row=1, max_row=None, max_col=None, values_only=False):
                if values_only:
                    yield from super().iter_rows(
                        min_row=min_row, max_row=max_row, max_col=max_col, values_only=values_only
                    )
                    return
                raise RuntimeError("row extraction failed")

        image_bytes = b"\x89PNG\r\n\x1a\nfailing-row-image"
        workbooks = [
            _FakeWorkbook(
                {
                    "Data": _FakeSheet(
                        header_rows=[("Question", "Image")],
                        data_rows=[(_FakeCell("Q1"), _FakeCell(None))],
                        images=[_FakeImage(image_bytes, row=1, col=1)],
                    )
                }
            ),
            _FakeWorkbook(
                {
                    "Data": FailingSheet(
                        header_rows=[("Question", "Image")],
                        data_rows=[],
                        images=[_FakeImage(image_bytes, row=1, col=1)],
                    )
                }
            ),
        ]
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbooks.pop(0))
        writer = _ImageWriter()

        extractor = ExcelExtractor("/tmp/sample.xlsx", image_writer=writer)
        extractor.extract()

        with pytest.raises(RuntimeError, match="row extraction failed"):
            extractor.extract()

        assert writer.calls == [
            ExtractedImage(content=image_bytes, extension="png", mime_type="image/png"),
            ExtractedImage(content=image_bytes, extension="png", mime_type="image/png"),
        ]

    def test_excel_text_only_extraction_skips_embedded_image_persistence(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        sheet = _FakeSheet(
            header_rows=[("Question", "Image")],
            data_rows=[(_FakeCell("Q1"), _FakeCell(None))],
            images=[_FakeImage(b"\x89PNG\r\n\x1a\npreview-image", row=1, col=1)],
        )
        workbook = _FakeWorkbook({"Data": sheet})
        monkeypatch.setattr(excel_module, "load_workbook", lambda *args, **kwargs: workbook)
        extractor = ExcelExtractor("/tmp/sample.xlsx")

        documents = extractor.extract()

        assert documents[0].page_content == '"Question":"Q1";"Image":""'

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
