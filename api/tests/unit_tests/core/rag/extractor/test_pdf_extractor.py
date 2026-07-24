from dataclasses import dataclass
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import core.rag.extractor.pdf_extractor as pe
from models.model import UploadFile

TENANT_ID = str(uuid4())
USER_ID = str(uuid4())


class _Storage:
    saves: list[tuple[str, bytes]]

    def __init__(self) -> None:
        self.saves = []

    def save(self, key: str, data: bytes) -> None:
        self.saves.append((key, data))


class _DatabaseBinding:
    session: Session

    def __init__(self, session: Session) -> None:
        self.session = session


@dataclass(frozen=True)
class _Dependencies:
    storage: _Storage
    session: Session


@pytest.fixture
def mock_dependencies(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> _Dependencies:
    storage = _Storage()
    monkeypatch.setattr(pe, "storage", storage)
    monkeypatch.setattr(pe, "db", _DatabaseBinding(sqlite_session))
    monkeypatch.setattr(pe.dify_config, "FILES_URL", "http://files.local")
    monkeypatch.setattr(pe.dify_config, "INTERNAL_FILES_URL", None)
    monkeypatch.setattr(pe.dify_config, "STORAGE_TYPE", "local")
    return _Dependencies(storage=storage, session=sqlite_session)


@pytest.mark.parametrize(
    ("image_bytes", "expected_mime", "expected_ext"),
    [
        (b"\xff\xd8\xff some jpeg", "image/jpeg", "jpg"),
        (b"\x89PNG\r\n\x1a\n some png", "image/png", "png"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_formats(
    mock_dependencies: _Dependencies, image_bytes: bytes, expected_mime: str, expected_ext: str
):
    # Mock page and image objects
    mock_page = MagicMock()
    mock_image_obj = MagicMock()

    def mock_extract(buf, fb_format=None):
        buf.write(image_bytes)

    mock_image_obj.extract.side_effect = mock_extract

    mock_page.get_objects.return_value = [mock_image_obj]

    extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id=TENANT_ID, user_id=USER_ID)

    # We need to handle the import inside _extract_images
    with patch("pypdfium2.raw", autospec=True) as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    upload_file = mock_dependencies.session.scalar(select(UploadFile))
    assert upload_file is not None
    assert f"![image](http://files.local/files/{upload_file.id}/file-preview)" in result
    assert mock_dependencies.storage.saves == [(upload_file.key, image_bytes)]
    assert upload_file.tenant_id == TENANT_ID
    assert upload_file.size == len(image_bytes)
    assert upload_file.mime_type == expected_mime
    assert upload_file.extension == expected_ext


@pytest.mark.parametrize(
    ("get_objects_side_effect", "get_objects_return_value"),
    [
        (None, []),  # Empty list
        (None, None),  # None returned
        (Exception("Failed to get objects"), None),  # Exception raised
    ],
)
@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_get_objects_scenarios(
    mock_dependencies: _Dependencies, get_objects_side_effect, get_objects_return_value
):
    mock_page = MagicMock()
    if get_objects_side_effect:
        mock_page.get_objects.side_effect = get_objects_side_effect
    else:
        mock_page.get_objects.return_value = get_objects_return_value

    extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id=TENANT_ID, user_id=USER_ID)

    with patch("pypdfium2.raw", autospec=True) as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    assert result == ""


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_calls_extract_images(mock_dependencies: _Dependencies, monkeypatch: pytest.MonkeyPatch):
    # Mock pypdfium2
    mock_pdf_doc = MagicMock()
    mock_page = MagicMock()
    mock_pdf_doc.__iter__.return_value = [mock_page]

    # Mock text extraction
    mock_text_page = MagicMock()
    mock_text_page.get_text_range.return_value = "Page text content"
    mock_page.get_textpage.return_value = mock_text_page

    with patch("pypdfium2.PdfDocument", return_value=mock_pdf_doc, autospec=True):
        # Mock Blob
        mock_blob = MagicMock()
        mock_blob.source = "test.pdf"
        with patch("core.rag.extractor.pdf_extractor.Blob.from_path", return_value=mock_blob, autospec=True):
            extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id=TENANT_ID, user_id=USER_ID)

            # Mock _extract_images to return a known string
            monkeypatch.setattr(extractor, "_extract_images", lambda p: "![image](img_url)")

            documents = list(extractor.extract())

            assert len(documents) == 1
            assert "Page text content" in documents[0].page_content
            assert "![image](img_url)" in documents[0].page_content
            assert documents[0].metadata["page"] == 0


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_failures(mock_dependencies: _Dependencies):
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

    extractor = pe.PdfExtractor(file_path="test.pdf", tenant_id=TENANT_ID, user_id=USER_ID)

    with patch("pypdfium2.raw", autospec=True) as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    # Should have one success
    upload_file = mock_dependencies.session.scalar(select(UploadFile))
    assert upload_file is not None
    assert f"![image](http://files.local/files/{upload_file.id}/file-preview)" in result
    assert mock_dependencies.storage.saves == [(upload_file.key, jpeg_bytes)]
