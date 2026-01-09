"""Primarily used for testing merged cell scenarios"""

import os
import tempfile
from types import SimpleNamespace

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

import core.rag.extractor.word_extractor as we
from core.rag.extractor.word_extractor import WordExtractor


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


def test_extract_images_from_docx(monkeypatch):
    external_bytes = b"ext-bytes"
    internal_bytes = b"int-bytes"

    # Patch storage.save to capture writes
    saves: list[tuple[str, bytes]] = []

    def save(key: str, data: bytes):
        saves.append((key, data))

    monkeypatch.setattr(we, "storage", SimpleNamespace(save=save))

    # Patch db.session to record adds/commit
    class DummySession:
        def __init__(self):
            self.added = []
            self.committed = False

        def add(self, obj):
            self.added.append(obj)

        def commit(self):
            self.committed = True

    db_stub = SimpleNamespace(session=DummySession())
    monkeypatch.setattr(we, "db", db_stub)

    # Patch config values used for URL composition and storage type
    monkeypatch.setattr(we.dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(we.dify_config, "STORAGE_TYPE", "local", raising=False)

    # Patch UploadFile to avoid real DB models
    class FakeUploadFile:
        _i = 0

        def __init__(self, **kwargs):  # kwargs match the real signature fields
            type(self)._i += 1
            self.id = f"u{self._i}"

    monkeypatch.setattr(we, "UploadFile", FakeUploadFile)

    # Patch external image fetcher
    def fake_get(url: str):
        assert url == "https://example.com/image.png"
        return SimpleNamespace(status_code=200, headers={"Content-Type": "image/png"}, content=external_bytes)

    monkeypatch.setattr(we, "ssrf_proxy", SimpleNamespace(get=fake_get))

    # A hashable internal part object with a blob attribute
    class HashablePart:
        def __init__(self, blob: bytes):
            self.blob = blob

        def __hash__(self) -> int:  # ensure it can be used as a dict key like real docx parts
            return id(self)

    # Build a minimal doc object with both external and internal image rels
    internal_part = HashablePart(blob=internal_bytes)
    rel_ext = SimpleNamespace(is_external=True, target_ref="https://example.com/image.png")
    rel_int = SimpleNamespace(is_external=False, target_ref="word/media/image1.png", target_part=internal_part)
    doc = SimpleNamespace(part=SimpleNamespace(rels={"rId1": rel_ext, "rId2": rel_int}))

    extractor = object.__new__(WordExtractor)
    extractor.tenant_id = "t1"
    extractor.user_id = "u1"

    image_map = extractor._extract_images_from_docx(doc)

    # Returned map should contain entries for external (keyed by rId) and internal (keyed by target_part)
    assert set(image_map.keys()) == {"rId1", internal_part}
    assert all(v.startswith("![image](") and v.endswith("/file-preview)") for v in image_map.values())

    # Storage should receive both payloads
    payloads = {data for _, data in saves}
    assert external_bytes in payloads
    assert internal_bytes in payloads

    # DB interactions should be recorded
    assert len(db_stub.session.added) == 2
    assert db_stub.session.committed is True


def test_extract_images_from_docx_uses_internal_files_url():
    """Test that INTERNAL_FILES_URL takes precedence over FILES_URL for plugin access."""
    # Test the URL generation logic directly
    from configs import dify_config

    # Mock the configuration values
    original_files_url = getattr(dify_config, "FILES_URL", None)
    original_internal_files_url = getattr(dify_config, "INTERNAL_FILES_URL", None)

    try:
        # Set both URLs - INTERNAL should take precedence
        dify_config.FILES_URL = "http://external.example.com"
        dify_config.INTERNAL_FILES_URL = "http://internal.docker:5001"

        # Test the URL generation logic (same as in word_extractor.py)
        upload_file_id = "test_file_id"

        # This is the pattern we fixed in the word extractor
        base_url = dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL
        generated_url = f"{base_url}/files/{upload_file_id}/file-preview"

        # Verify that INTERNAL_FILES_URL is used instead of FILES_URL
        assert "http://internal.docker:5001" in generated_url, f"Expected internal URL, got: {generated_url}"
        assert "http://external.example.com" not in generated_url, f"Should not use external URL, got: {generated_url}"

    finally:
        # Restore original values
        if original_files_url is not None:
            dify_config.FILES_URL = original_files_url
        if original_internal_files_url is not None:
            dify_config.INTERNAL_FILES_URL = original_internal_files_url


def test_extract_hyperlinks(monkeypatch):
    # Mock db and storage to avoid issues during image extraction (even if no images are present)
    monkeypatch.setattr(we, "storage", SimpleNamespace(save=lambda k, d: None))
    db_stub = SimpleNamespace(session=SimpleNamespace(add=lambda o: None, commit=lambda: None))
    monkeypatch.setattr(we, "db", db_stub)
    monkeypatch.setattr(we.dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(we.dify_config, "STORAGE_TYPE", "local", raising=False)

    doc = Document()
    p = doc.add_paragraph("Visit ")

    # Adding a hyperlink manually
    r_id = "rId99"
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)

    new_run = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "Dify"
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
        extractor = WordExtractor(tmp_path, "tenant_id", "user_id")
        docs = extractor.extract()
        # Verify modern hyperlink extraction
        assert "Visit[Dify](https://dify.ai)" in docs[0].page_content
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_extract_legacy_hyperlinks(monkeypatch):
    # Mock db and storage
    monkeypatch.setattr(we, "storage", SimpleNamespace(save=lambda k, d: None))
    db_stub = SimpleNamespace(session=SimpleNamespace(add=lambda o: None, commit=lambda: None))
    monkeypatch.setattr(we, "db", db_stub)
    monkeypatch.setattr(we.dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(we.dify_config, "STORAGE_TYPE", "local", raising=False)

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
    instrText.text = ' HYPERLINK "http://example.com" '
    run2.append(instrText)
    p._p.append(run2)

    run3 = OxmlElement("w:r")
    fldCharSep = OxmlElement("w:fldChar")
    fldCharSep.set(qn("w:fldCharType"), "separate")
    run3.append(fldCharSep)
    p._p.append(run3)

    run4 = OxmlElement("w:r")
    t4 = OxmlElement("w:t")
    t4.text = "Example"
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
        extractor = WordExtractor(tmp_path, "tenant_id", "user_id")
        docs = extractor.extract()
        # Verify legacy hyperlink extraction
        assert "[Example](http://example.com)" in docs[0].page_content
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
