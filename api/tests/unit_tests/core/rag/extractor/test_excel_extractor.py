from types import SimpleNamespace

import pandas as pd
import pytest

import core.rag.extractor.excel_extractor as excel_module
from core.rag.extractor.excel_extractor import ExcelExtractor


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


class _FieldExpression:
    def __eq__(self, other):
        return ("eq", other)

    def in_(self, values):
        return ("in", tuple(values))


class _SelectStub:
    def where(self, *args, **kwargs):
        return self


class _FakeUploadFile:
    tenant_id = _FieldExpression()
    key = _FieldExpression()
    _i = 0

    def __init__(self, **kwargs):
        type(self)._i += 1
        self.id = f"u{self._i}"
        self.key = kwargs["key"]


class _PersistentSession:
    def __init__(self, persisted):
        self._persisted = persisted
        self.added = []
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def scalars(self, _stmt):
        return SimpleNamespace(all=lambda: list(self._persisted.values()))

    def add_all(self, objects) -> None:
        self.added.extend(objects)

    def commit(self) -> None:
        self.commit_count += 1
        for upload_file in self.added:
            self._persisted[upload_file.key] = upload_file
        self.added.clear()


class _PersistentSessionFactory:
    def __init__(self):
        self.persisted = {}
        self.sessions = []

    def create_session(self):
        session = _PersistentSession(self.persisted)
        self.sessions.append(session)
        return session


def _patch_image_persistence(monkeypatch: pytest.MonkeyPatch):
    saves: list[tuple[str, bytes]] = []
    session_factory = _PersistentSessionFactory()

    def save(key: str, data: bytes) -> None:
        saves.append((key, data))

    _FakeUploadFile._i = 0
    monkeypatch.setattr(excel_module, "storage", SimpleNamespace(save=save))
    monkeypatch.setattr(excel_module, "session_factory", session_factory)
    monkeypatch.setattr(excel_module, "select", lambda *args, **kwargs: _SelectStub())
    monkeypatch.setattr(excel_module, "UploadFile", _FakeUploadFile)
    monkeypatch.setattr(excel_module.dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(excel_module.dify_config, "STORAGE_TYPE", "local", raising=False)

    return saves, session_factory


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

    def test_extract_xlsx_turns_embedded_images_into_markdown_links(self, monkeypatch: pytest.MonkeyPatch):
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
        saves, session_factory = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            "/tmp/sample.xlsx",
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        docs = extractor.extract()

        assert workbook.closed is True
        assert len(docs) == 2
        assert docs[0].page_content == (
            '"Question":"Q1";"Answer":"A1";'
            '"Image":"![image](http://files.local/files/u1/file-preview) '
            '![image](http://files.local/files/u1/file-preview)"'
        )
        assert docs[1].page_content == '"Question":"Q2";"Answer":"A2";"Image":""'
        assert len(saves) == 1
        assert saves[0][0].startswith("image_files/tenant-1/source-file-1/")
        assert saves[0][0].endswith(".png")
        assert saves[0][1] == image_bytes
        assert len(session_factory.persisted) == 1
        assert [session.commit_count for session in session_factory.sessions] == [1]

    def test_extract_xlsx_keeps_rows_with_only_embedded_images(self, monkeypatch: pytest.MonkeyPatch):
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
        saves, session_factory = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            "/tmp/sample.xlsx",
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        docs = extractor.extract()

        assert workbook.closed is True
        assert len(docs) == 1
        assert docs[0].page_content == (
            '"Question":"";"Answer":"";"Image":"![image](http://files.local/files/u1/file-preview)"'
        )
        assert len(saves) == 1
        assert len(session_factory.persisted) == 1
        assert [session.commit_count for session in session_factory.sessions] == [1]

    def test_extract_xlsx_reuses_existing_embedded_image_uploads_on_retry(self, monkeypatch: pytest.MonkeyPatch):
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
        saves, session_factory = _patch_image_persistence(monkeypatch)

        extractor = ExcelExtractor(
            "/tmp/sample.xlsx",
            tenant_id="tenant-1",
            user_id="user-1",
            source_file_id="source-file-1",
        )
        first_docs = extractor.extract()
        second_docs = extractor.extract()

        expected_page_content = (
            '"Question":"Q1";"Answer":"A1";"Image":"![image](http://files.local/files/u1/file-preview)"'
        )

        assert first_docs[0].page_content == expected_page_content
        assert second_docs[0].page_content == expected_page_content
        assert len(saves) == 1
        assert len(session_factory.persisted) == 1
        assert [session.commit_count for session in session_factory.sessions] == [1, 0]

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
