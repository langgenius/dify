from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import core.rag.extractor.pdf_extractor as pe


@pytest.fixture
def mock_dependencies(monkeypatch):
    # Mock storage
    saves = []

    def save(key, data):
        saves.append((key, data))

    monkeypatch.setattr(pe, "storage", SimpleNamespace(save=save))

    # Mock db
    class DummySession:
        def __init__(self):
            self.added = []
            self.committed = False

        def add(self, obj):
            self.added.append(obj)

        def add_all(self, objs):
            self.added.extend(objs)

        def commit(self):
            self.committed = True

    db_stub = SimpleNamespace(session=DummySession())
    monkeypatch.setattr(pe, "db", db_stub)

    # Mock UploadFile
    class FakeUploadFile:
        DEFAULT_ID = "test_file_id"

        def __init__(self, **kwargs):
            # Assign id from DEFAULT_ID, allow override via kwargs if needed
            self.id = self.DEFAULT_ID
            for k, v in kwargs.items():
                setattr(self, k, v)

    monkeypatch.setattr(pe, "UploadFile", FakeUploadFile)

    # Mock config
    monkeypatch.setattr(pe.dify_config, "FILES_URL", "http://files.local")
    monkeypatch.setattr(pe.dify_config, "INTERNAL_FILES_URL", None)
    monkeypatch.setattr(pe.dify_config, "STORAGE_TYPE", "local")

    return SimpleNamespace(saves=saves, db=db_stub, UploadFile=FakeUploadFile)


@pytest.mark.parametrize(
    ("image_bytes", "expected_mime", "expected_ext", "file_id"),
    [
        (b"\xff\xd8\xff some jpeg", "image/jpeg", "jpg", "test_file_id_jpeg"),
        (b"\x89PNG\r\n\x1a\n some png", "image/png", "png", "test_file_id_png"),
    ],
)
def test_extract_images_formats(mock_dependencies, monkeypatch, image_bytes, expected_mime, expected_ext, file_id):
    saves = mock_dependencies.saves
    db_stub = mock_dependencies.db

    # Customize FakeUploadFile id for this test case.
    # Using monkeypatch ensures the class attribute is reset between parameter sets.
    monkeypatch.setattr(mock_dependencies.UploadFile, "DEFAULT_ID", file_id)

    # Mock page and image objects
    mock_page = MagicMock()
    mock_image_obj = MagicMock()

    def mock_extract(buf, fb_format=None):
        buf.write(image_bytes)

    mock_image_obj.extract.side_effect = mock_extract

    mock_page.get_objects.return_value = [mock_image_obj]

    extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id="t1", user_id="u1")

    # We need to handle the import inside _extract_images
    with patch("pypdfium2.raw") as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    assert f"![image](http://files.local/files/{file_id}/file-preview)" in result
    assert len(saves) == 1
    assert saves[0][1] == image_bytes
    assert len(db_stub.session.added) == 1
    assert db_stub.session.added[0].tenant_id == "t1"
    assert db_stub.session.added[0].size == len(image_bytes)
    assert db_stub.session.added[0].mime_type == expected_mime
    assert db_stub.session.added[0].extension == expected_ext
    assert db_stub.session.committed is True


@pytest.mark.parametrize(
    ("get_objects_side_effect", "get_objects_return_value"),
    [
        (None, []),  # Empty list
        (None, None),  # None returned
        (Exception("Failed to get objects"), None),  # Exception raised
    ],
)
def test_extract_images_get_objects_scenarios(mock_dependencies, get_objects_side_effect, get_objects_return_value):
    mock_page = MagicMock()
    if get_objects_side_effect:
        mock_page.get_objects.side_effect = get_objects_side_effect
    else:
        mock_page.get_objects.return_value = get_objects_return_value

    extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id="t1", user_id="u1")

    with patch("pypdfium2.raw") as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    assert result == ""


def test_extract_calls_extract_images(mock_dependencies, monkeypatch):
    # Mock pypdfium2
    mock_pdf_doc = MagicMock()
    mock_page = MagicMock()
    mock_pdf_doc.__iter__.return_value = [mock_page]

    # Mock text extraction
    mock_text_page = MagicMock()
    mock_text_page.get_text_range.return_value = "Page text content"
    mock_page.get_textpage.return_value = mock_text_page

    with patch("pypdfium2.PdfDocument", return_value=mock_pdf_doc):
        # Mock Blob
        mock_blob = MagicMock()
        mock_blob.source = "test.pdf"
        with patch("core.rag.extractor.pdf_extractor.Blob.from_path", return_value=mock_blob):
            extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id="t1", user_id="u1")

            # Mock _extract_images to return a known string
            monkeypatch.setattr(extractor, "_extract_images", lambda p: "![image](img_url)")

            documents = list(extractor.extract())

            assert len(documents) == 1
            assert "Page text content" in documents[0].page_content
            assert "![image](img_url)" in documents[0].page_content
            assert documents[0].metadata["page"] == 0


def test_extract_images_failures(mock_dependencies):
    saves = mock_dependencies.saves
    db_stub = mock_dependencies.db

    # Mock page and image objects
    mock_page = MagicMock()
    mock_image_obj_fail = MagicMock()
    mock_image_obj_ok = MagicMock()

    # First image raises exception
    mock_image_obj_fail.extract.side_effect = Exception("Extraction failure")

    # Second image is OK (JPEG)
    jpeg_bytes = b"\xff\xd8\xff some image data"

    def mock_extract(buf, fb_format=None):
        buf.write(jpeg_bytes)

    mock_image_obj_ok.extract.side_effect = mock_extract

    mock_page.get_objects.return_value = [mock_image_obj_fail, mock_image_obj_ok]

    extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id="t1", user_id="u1")

    with patch("pypdfium2.raw") as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    # Should have one success
    assert "![image](http://files.local/files/test_file_id/file-preview)" in result
    assert len(saves) == 1
    assert saves[0][1] == jpeg_bytes
    assert db_stub.session.committed is True
