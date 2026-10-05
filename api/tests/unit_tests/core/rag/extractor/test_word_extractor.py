"""Primarily used for testing merged cell scenarios"""

import io
import logging
import os
import tempfile
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import pytest
from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from httpx import Response
from sqlalchemy import event, select
from sqlalchemy.orm import Session

import core.rag.extractor.word_extractor as we
from core.rag.extractor.word_extractor import WordExtractor
from models.model import UploadFile
from tests.unit_tests.config_override import apply_config_overrides


class _TextOxmlElement(Protocol):
    text: str | None


@dataclass
class _CloseRecorder:
    result: object | None = None
    close_calls: int = 0

    def close(self) -> object | None:
        self.close_calls += 1
        return self.result


def _set_oxml_text(element: object, text: str) -> None:
    cast(_TextOxmlElement, element).text = text


def _image_part(name: str, blob: bytes = b"image-bytes") -> Part:
    return Part(PackURI(f"/word/media/{name}"), "image/png", blob)


def _generate_table_with_merged_cells():
    doc = Document()

    """
    The table looks like this:
    +-----+-----+-----+
    | 1-1 & 1-2 | 1-3 |
    +-----+-----+-----+
    | 2-1 | 2-2 | 2-3 |
    |  &  |-----+-----+
    | 3-1 | 3-2 | 3-3 |
    +-----+-----+-----+
    """
    table = doc.add_table(rows=3, cols=3)
    table.style = "Table Grid"

    for i in range(3):
        for j in range(3):
            cell = table.cell(i, j)
            cell.text = f"{i + 1}-{j + 1}"

    # Merge cells
    cell_0_0 = table.cell(0, 0)
    cell_0_1 = table.cell(0, 1)
    merged_cell_1 = cell_0_0.merge(cell_0_1)
    merged_cell_1.text = "1-1 & 1-2"

    cell_1_0 = table.cell(1, 0)
    cell_2_0 = table.cell(2, 0)
    merged_cell_2 = cell_1_0.merge(cell_2_0)
    merged_cell_2.text = "2-1 & 3-1"

    ground_truth = [["1-1 & 1-2", "", "1-3"], ["2-1 & 3-1", "2-2", "2-3"], ["2-1 & 3-1", "3-2", "3-3"]]

    return doc.tables[0], ground_truth


def test_parse_row():
    table, gt = _generate_table_with_merged_cells()
    extractor = object.__new__(WordExtractor)
    for idx, row in enumerate(table.rows):
        assert extractor._parse_row(row, {}, 3) == gt[idx]


def test_init_downloads_via_remote_fetcher(monkeypatch: pytest.MonkeyPatch):
    doc = Document()
    doc.add_paragraph("hello")
    buf = io.BytesIO()
    doc.save(buf)
    docx_bytes = buf.getvalue()

    calls: list[tuple[str, tuple[str, dict[str, object]] | None]] = []

    response = Response(200, content=docx_bytes)

    def fake_make_request(method: str, url: str, **kwargs):
        assert method == "GET"
        calls.append(("get", (url, kwargs)))
        return response

    monkeypatch.setattr(we.remote_fetcher, "make_request", fake_make_request)

    extractor = WordExtractor("https://example.com/test.docx", "tenant_id", "user_id")
    try:
        assert calls
        assert calls[0][0] == "get"
        first_call = calls[0][1]
        assert first_call is not None
        url, kwargs = first_call
        assert url == "https://example.com/test.docx"
        assert kwargs.get("timeout") is None
        assert extractor.web_path == "https://example.com/test.docx"
        assert extractor.file_path != extractor.web_path
        assert Path(extractor.file_path).read_bytes() == docx_bytes
        assert response.is_closed
    finally:
        extractor.temp_file.close()


@pytest.mark.parametrize("inject_session", [False, True])
def test_extract_images_from_docx(monkeypatch: pytest.MonkeyPatch, inject_session: bool, sqlite_session: Session):
    external_bytes = b"ext-bytes"
    internal_bytes = b"int-bytes"

    # Patch storage.save to capture writes
    saves: list[tuple[str, bytes]] = []

    def save(key: str, data: bytes):
        saves.append((key, data))

    monkeypatch.setattr(we.storage, "save", save)
    monkeypatch.setattr(we.db, "session", sqlite_session, raising=False)

    # Patch config values used for URL composition and storage type
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local", STORAGE_TYPE="local")

    # Patch external image fetcher
    def fake_make_request(method: str, url: str, **kwargs):
        assert method == "GET"
        assert url == "https://example.com/image.png"
        return Response(200, headers={"Content-Type": "image/png"}, content=external_bytes)

    monkeypatch.setattr(we.remote_fetcher, "make_request", fake_make_request)

    doc = Document()
    internal_part = _image_part("image1.png", internal_bytes)
    doc.part.rels.add_relationship(RT.IMAGE, "https://example.com/image.png", "rId1", is_external=True)
    doc.part.rels.add_relationship(RT.IMAGE, internal_part, "rId2")

    extractor = object.__new__(WordExtractor)
    extractor.tenant_id = "00000000-0000-0000-0000-000000000001"
    extractor.user_id = "00000000-0000-0000-0000-000000000002"
    extractor._session = sqlite_session if inject_session else None
    transaction_events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))

    image_map = extractor._extract_images_from_docx(doc)

    # Returned map should contain entries for external (keyed by rId) and internal (keyed by target_part)
    assert set(image_map.keys()) == {"rId1", internal_part}
    assert all(v.startswith("![image](") and v.endswith("/file-preview)") for v in image_map.values())

    # Storage should receive both payloads
    payloads = {data for _, data in saves}
    assert external_bytes in payloads
    assert internal_bytes in payloads

    assert len(sqlite_session.scalars(select(UploadFile)).all()) == 2
    assert transaction_events == ([] if inject_session else ["commit"])


def test_extract_images_does_not_stage_partial_files_on_storage_failure(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    doc = Document()
    doc.part.rels.add_relationship(RT.IMAGE, _image_part("image1.png", b"first"), "rId1")
    doc.part.rels.add_relationship(RT.IMAGE, _image_part("image2.png", b"second"), "rId2")

    save_calls = 0

    def save(key: str, data: bytes) -> None:
        nonlocal save_calls
        save_calls += 1
        if save_calls == 2:
            raise RuntimeError("storage failure")

    monkeypatch.setattr(we.storage, "save", save)
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local", STORAGE_TYPE="local")

    extractor = object.__new__(WordExtractor)
    extractor.tenant_id = "00000000-0000-0000-0000-000000000001"
    extractor.user_id = "00000000-0000-0000-0000-000000000002"
    extractor._session = sqlite_session

    with pytest.raises(RuntimeError, match="storage failure"):
        extractor._extract_images_from_docx(doc)

    assert sqlite_session.scalars(select(UploadFile)).all() == []


def test_extract_images_from_docx_uses_internal_files_url(monkeypatch: pytest.MonkeyPatch):
    """Test that INTERNAL_FILES_URL takes precedence over FILES_URL for plugin access."""
    # Test the URL generation logic directly
    from configs import dify_config

    apply_config_overrides(
        monkeypatch,
        FILES_URL="http://external.example.com",
        INTERNAL_FILES_URL="http://internal.docker:5001",
    )

    upload_file_id = "test_file_id"

    base_url = dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL
    generated_url = f"{base_url}/files/{upload_file_id}/file-preview"

    assert "http://internal.docker:5001" in generated_url, f"Expected internal URL, got: {generated_url}"
    assert "http://external.example.com" not in generated_url, f"Should not use external URL, got: {generated_url}"


def test_extract_hyperlinks(monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
    # Mock db and storage to avoid issues during image extraction (even if no images are present)
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local", STORAGE_TYPE="local")

    doc = Document()
    p = doc.add_paragraph("Visit ")

    # Adding a hyperlink manually
    r_id = "rId99"
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)

    new_run = OxmlElement("w:r")
    t = OxmlElement("w:t")
    _set_oxml_text(t, "Dify")
    new_run.append(t)
    hyperlink.append(new_run)
    p._p.append(hyperlink)

    # Add relationship to the part
    doc.part.rels.add_relationship(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        "https://dify.ai",
        r_id,
        is_external=True,
    )

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        doc.save(tmp.name)
        tmp_path = tmp.name

    try:
        extractor = WordExtractor(tmp_path, "tenant_id", "user_id", session=unbound_session)
        docs = extractor.extract()
        # Verify modern hyperlink extraction
        assert "Visit[Dify](https://dify.ai)" in docs[0].page_content
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_extract_legacy_hyperlinks(monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
    # Mock db and storage
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local", STORAGE_TYPE="local")

    doc = Document()
    p = doc.add_paragraph()

    # Construct a legacy HYPERLINK field:
    # 1. w:fldChar (begin)
    # 2. w:instrText (HYPERLINK "http://example.com")
    # 3. w:fldChar (separate)
    # 4. w:r (visible text "Example")
    # 5. w:fldChar (end)

    run1 = OxmlElement("w:r")
    fldCharBegin = OxmlElement("w:fldChar")
    fldCharBegin.set(qn("w:fldCharType"), "begin")
    run1.append(fldCharBegin)
    p._p.append(run1)

    run2 = OxmlElement("w:r")
    instrText = OxmlElement("w:instrText")
    _set_oxml_text(instrText, ' HYPERLINK "http://example.com" ')
    run2.append(instrText)
    p._p.append(run2)

    run3 = OxmlElement("w:r")
    fldCharSep = OxmlElement("w:fldChar")
    fldCharSep.set(qn("w:fldCharType"), "separate")
    run3.append(fldCharSep)
    p._p.append(run3)

    run4 = OxmlElement("w:r")
    t4 = OxmlElement("w:t")
    _set_oxml_text(t4, "Example")
    run4.append(t4)
    p._p.append(run4)

    run5 = OxmlElement("w:r")
    fldCharEnd = OxmlElement("w:fldChar")
    fldCharEnd.set(qn("w:fldCharType"), "end")
    run5.append(fldCharEnd)
    p._p.append(run5)

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        doc.save(tmp.name)
        tmp_path = tmp.name

    try:
        extractor = WordExtractor(tmp_path, "tenant_id", "user_id", session=unbound_session)
        docs = extractor.extract()
        # Verify legacy hyperlink extraction
        assert "[Example](http://example.com)" in docs[0].page_content
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_init_rejects_invalid_url_status(monkeypatch: pytest.MonkeyPatch):
    response = Response(404, content=b"")
    monkeypatch.setattr(we.remote_fetcher, "make_request", lambda method, url, **kwargs: response)

    with pytest.raises(ValueError, match="returned status code 404"):
        WordExtractor("https://example.com/missing.docx", "tenant", "user")

    assert response.is_closed


def test_init_expands_home_path_and_invalid_local_path(monkeypatch, tmp_path: Path):
    target_file = tmp_path / "expanded.docx"
    target_file.write_bytes(b"docx")

    monkeypatch.setattr(we.os.path, "expanduser", lambda p: str(target_file))
    monkeypatch.setattr(
        we.os.path,
        "isfile",
        lambda p: p == str(target_file),
    )

    extractor = WordExtractor("~/expanded.docx", "tenant", "user")
    assert extractor.file_path == str(target_file)

    monkeypatch.setattr(we.os.path, "isfile", lambda p: False)
    with pytest.raises(ValueError, match="is not a valid file or url"):
        WordExtractor("not-a-file", "tenant", "user")


def test_close_closes_temp_file():
    extractor = object.__new__(WordExtractor)
    extractor._closed = False
    with tempfile.NamedTemporaryFile() as temp_file:
        extractor.temp_file = temp_file

        extractor.close()

        assert temp_file.file.closed


def test_close_is_idempotent():
    extractor = object.__new__(WordExtractor)
    extractor._closed = False
    with tempfile.NamedTemporaryFile() as temp_file:
        extractor.temp_file = temp_file

        extractor.close()
        extractor.close()

        assert temp_file.file.closed


def test_close_closes_awaitable_close_result():
    class FakeAwaitable:
        closed: bool = False

        def __await__(self) -> Generator[None, None, None]:
            if False:
                yield None
            return None

        def close(self) -> None:
            self.closed = True

    extractor = object.__new__(WordExtractor)
    extractor._closed = False
    close_result = FakeAwaitable()
    extractor.temp_file = _CloseRecorder(result=close_result)

    extractor.close()

    assert close_result.closed is True
    assert extractor.temp_file.close_calls == 1


def test_extract_images_handles_invalid_external_cases(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    doc = Document()
    doc.part.rels.add_relationship(RT.IMAGE, "image-no-url", "r1", is_external=True)
    doc.part.rels.add_relationship(RT.IMAGE, "https://example.com/image-error", "r2", is_external=True)
    doc.part.rels.add_relationship(RT.IMAGE, "https://example.com/image-unknown", "r3", is_external=True)

    def fake_make_request(method, url, **kwargs):
        assert method == "GET"
        if "image-error" in url:
            raise RuntimeError("network")
        return Response(200, headers={"Content-Type": "application/unknown"}, content=b"x")

    monkeypatch.setattr(we.remote_fetcher, "make_request", fake_make_request)
    monkeypatch.setattr(we.db, "session", sqlite_session, raising=False)
    apply_config_overrides(monkeypatch, FILES_URL="http://files.local")

    extractor = object.__new__(WordExtractor)
    extractor.tenant_id = "tenant"
    extractor.user_id = "user"
    extractor._session = None
    transaction_events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))

    result = extractor._extract_images_from_docx(doc)

    assert result == {}
    assert transaction_events == ["commit"]


def test_table_to_markdown_and_parse_helpers(monkeypatch: pytest.MonkeyPatch):
    extractor = object.__new__(WordExtractor)

    doc = Document()
    table = doc.add_table(rows=2, cols=2)
    parsed_rows = iter([["H1", "H2"], ["A", "B"]])
    monkeypatch.setattr(extractor, "_parse_row", lambda row, image_map, total_cols: next(parsed_rows))

    markdown = extractor._table_to_markdown(table, {})
    assert markdown == "| H1 | H2 |\n| --- | --- |\n| A | B |"

    cell = doc.add_table(rows=1, cols=1).cell(0, 0)
    image_part = _image_part("cell-image.png")
    doc.part.rels.add_relationship(RT.IMAGE, "https://example.com/ext.png", "ext", is_external=True)
    doc.part.rels.add_relationship(RT.IMAGE, image_part, "int")

    def populate_paragraph(paragraph) -> None:
        image_run = OxmlElement("w:r")
        for image_id in (None, "ext", "int"):
            blip = OxmlElement("a:blip")
            if image_id is not None:
                blip.set(qn("r:embed"), image_id)
            image_run.append(blip)
        paragraph._p.append(image_run)
        paragraph.add_run("plain")

    paragraph = cell.paragraphs[0]
    populate_paragraph(paragraph)
    populate_paragraph(cell.add_paragraph())

    image_map = {"ext": "EXT-IMG", image_part: "INT-IMG"}
    assert extractor._parse_cell_paragraph(paragraph, image_map) == "EXT-IMGINT-IMGplain"
    assert extractor._parse_cell(cell, image_map) == "EXT-IMGINT-IMGplain"


def test_parse_docx_reads_real_paragraph_table_order(monkeypatch: pytest.MonkeyPatch):
    doc = Document()
    doc.add_paragraph("Before table")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Header A"
    table.cell(0, 1).text = "Header B"
    table.cell(1, 0).text = "Cell A"
    table.cell(1, 1).text = "Cell B"
    doc.add_paragraph("After table")

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        doc.save(tmp.name)
        tmp_path = tmp.name

    extractor = object.__new__(WordExtractor)
    monkeypatch.setattr(extractor, "_extract_images_from_docx", lambda doc: {})

    try:
        assert extractor.parse_docx(tmp_path) == (
            "Before table\n| Header A | Header B |\n| --- | --- |\n| Cell A | Cell B |\nAfter table"
        )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_parse_docx_covers_drawing_shapes_hyperlink_error_and_table_branch(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    extractor = object.__new__(WordExtractor)

    ext_image_id = "ext-image"
    int_embed_id = "int-embed"
    shape_ext_id = "shape-ext"
    shape_int_id = "shape-int"

    internal_part = _image_part("embedded.png")
    shape_internal_part = _image_part("shape.png")
    fake_doc = Document()
    rels = fake_doc.part.rels
    rels.add_relationship(RT.IMAGE, "https://img/ext.png", ext_image_id, is_external=True)
    rels.add_relationship(RT.IMAGE, internal_part, int_embed_id)
    rels.add_relationship(RT.IMAGE, "https://img/shape.png", shape_ext_id, is_external=True)
    rels.add_relationship(RT.IMAGE, shape_internal_part, shape_int_id)
    rels.add_relationship(RT.HYPERLINK, "https://example.com", "link-ok", is_external=True)

    relationship_get = rels.get

    def get_relationship(key, default=None):
        if key == "link-bad":
            raise RuntimeError("cannot resolve relation")
        return relationship_get(key, default)

    monkeypatch.setattr(rels, "get", get_relationship)

    image_map = {
        ext_image_id: "[EXT]",
        internal_part: "[INT]",
        shape_ext_id: "[SHAPE_EXT]",
        shape_internal_part: "[SHAPE_INT]",
    }

    class FakeBlip:
        def __init__(self, embed_id):
            self.embed_id = embed_id

        def get(self, key):
            return self.embed_id

    class FakeDrawing:
        def __init__(self, embed_ids):
            self.embed_ids = embed_ids

        def findall(self, pattern):
            return [FakeBlip(embed_id) for embed_id in self.embed_ids]

    class FakeNode:
        def __init__(self, text=None, attrs=None):
            self.text = text
            self._attrs = attrs or {}

        def get(self, key):
            return self._attrs.get(key)

    class FakeShape:
        def __init__(self, bin_id=None, img_id=None):
            self.bin_id = bin_id
            self.img_id = img_id

        def find(self, pattern):
            if "binData" in pattern and self.bin_id:
                return FakeNode(
                    text="shape",
                    attrs={"{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id": self.bin_id},
                )
            if "imagedata" in pattern and self.img_id:
                return FakeNode(attrs={"id": self.img_id})
            return None

    class FakeChild:
        def __init__(
            self,
            tag,
            text="",
            fld_chars=None,
            instr_texts=None,
            drawings=None,
            shapes=None,
            attrs=None,
            hyperlink_runs=None,
        ):
            self.tag = tag
            self.text = text
            self._fld_chars = fld_chars or []
            self._instr_texts = instr_texts or []
            self._drawings = drawings or []
            self._shapes = shapes or []
            self._attrs = attrs or {}
            self._hyperlink_runs = hyperlink_runs or []

        def findall(self, pattern):
            if pattern == qn("w:fldChar"):
                return self._fld_chars
            if pattern == qn("w:instrText"):
                return self._instr_texts
            if pattern == qn("w:r"):
                return self._hyperlink_runs
            if pattern.endswith("}drawing"):
                return self._drawings
            if pattern.endswith("}pict"):
                return self._shapes
            return []

        def get(self, key):
            return self._attrs.get(key)

    class FakeRun:
        def __init__(self, element, paragraph):
            self.element = element
            self.text = getattr(element, "text", "")

    class FakeParagraph:
        def __init__(self, children):
            self._element = children

    class FakeTable:
        rows: list[object] = []

    paragraph_main = FakeParagraph(
        [
            FakeChild(
                qn("w:r"),
                text="run-text",
                drawings=[FakeDrawing([ext_image_id, int_embed_id])],
                shapes=[FakeShape(bin_id=shape_ext_id, img_id=shape_int_id)],
            ),
            FakeChild(
                qn("w:r"),
                text="",
                drawings=[],
                shapes=[FakeShape(bin_id=shape_ext_id)],
            ),
            FakeChild(
                qn("w:hyperlink"),
                attrs={qn("r:id"): "link-ok"},
                hyperlink_runs=[FakeChild(qn("w:r"), text="LinkText")],
            ),
            FakeChild(
                qn("w:hyperlink"),
                attrs={qn("r:id"): "link-bad"},
                hyperlink_runs=[FakeChild(qn("w:r"), text="BrokenLink")],
            ),
        ]
    )
    paragraph_empty = FakeParagraph([FakeChild(qn("w:r"), text="   ")])
    table = FakeTable()

    monkeypatch.setattr(fake_doc, "iter_inner_content", lambda: iter([paragraph_main, paragraph_empty, table]))

    monkeypatch.setattr(we, "Paragraph", FakeParagraph)
    monkeypatch.setattr(we, "Table", FakeTable)
    monkeypatch.setattr(we, "DocxDocument", lambda _: fake_doc)
    monkeypatch.setattr(we, "Run", FakeRun)
    monkeypatch.setattr(extractor, "_extract_images_from_docx", lambda doc: image_map)
    monkeypatch.setattr(extractor, "_table_to_markdown", lambda table, image_map: "TABLE-MARKDOWN")

    with caplog.at_level(logging.ERROR, logger="core.rag.extractor.word_extractor"):
        content = extractor.parse_docx("dummy.docx")

    assert "[EXT]" in content
    assert "[INT]" in content
    assert "[SHAPE_EXT]" in content
    assert "[LinkText](https://example.com)" in content
    assert "BrokenLink" in content
    assert "TABLE-MARKDOWN" in content
    assert any(record.levelno == logging.ERROR for record in caplog.records)


def test_parse_cell_paragraph_hyperlink_in_table_cell_http():
    doc = Document()
    table = doc.add_table(rows=1, cols=1)
    cell = table.cell(0, 0)
    p = cell.paragraphs[0]

    # Build modern hyperlink inside table cell
    r_id = "rIdHttp1"
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)

    run_elem = OxmlElement("w:r")
    t = OxmlElement("w:t")
    _set_oxml_text(t, "Dify")
    run_elem.append(t)
    hyperlink.append(run_elem)
    p._p.append(hyperlink)

    # Relationship for external http link
    doc.part.rels.add_relationship(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        "https://dify.ai",
        r_id,
        is_external=True,
    )

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        doc.save(tmp.name)
        tmp_path = tmp.name

    try:
        reopened = Document(tmp_path)
        para = reopened.tables[0].cell(0, 0).paragraphs[0]
        extractor = object.__new__(WordExtractor)
        out = extractor._parse_cell_paragraph(para, {})
        assert out == "[Dify](https://dify.ai)"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_parse_cell_paragraph_hyperlink_in_table_cell_mailto():
    doc = Document()
    table = doc.add_table(rows=1, cols=1)
    cell = table.cell(0, 0)
    p = cell.paragraphs[0]

    r_id = "rIdMail1"
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)

    run_elem = OxmlElement("w:r")
    t = OxmlElement("w:t")
    _set_oxml_text(t, "john@test.com")
    run_elem.append(t)
    hyperlink.append(run_elem)
    p._p.append(hyperlink)

    doc.part.rels.add_relationship(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        "mailto:john@test.com",
        r_id,
        is_external=True,
    )

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        doc.save(tmp.name)
        tmp_path = tmp.name

    try:
        reopened = Document(tmp_path)
        para = reopened.tables[0].cell(0, 0).paragraphs[0]
        extractor = object.__new__(WordExtractor)
        out = extractor._parse_cell_paragraph(para, {})
        assert out == "[john@test.com](mailto:john@test.com)"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
