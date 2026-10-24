import hashlib
import io
from dataclasses import dataclass
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import core.rag.extractor.pdf_extractor as pe
from models.model import UploadFile
from tests.helpers.unit.config_override import apply_config_overrides

TENANT_ID = str(uuid4())
USER_ID = str(uuid4())


class _Storage:
    saves: list[tuple[str, bytes]]

    def __init__(self) -> None:
        self.saves = []

    def save(self, key: str, data: bytes) -> None:
        self.saves.append((key, data))


@dataclass(eq=False, repr=False)
class _DatabaseBinding:
    session: Session


@dataclass(frozen=True)
class _Dependencies:
    storage: _Storage
    session: Session


@pytest.fixture
def mock_dependencies(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> _Dependencies:
    storage = _Storage()
    monkeypatch.setattr(pe, "storage", storage)
    monkeypatch.setattr(pe, "db", _DatabaseBinding(sqlite_session))
    apply_config_overrides(
        monkeypatch,
        FILES_URL="http://files.local",
        INTERNAL_FILES_URL=None,
        STORAGE_TYPE="local",
    )
    return _Dependencies(storage=storage, session=sqlite_session)


@pytest.mark.parametrize(
    ("image_bytes", "expected_mime", "expected_ext"),
    [
        (b"\xff\xd8\xff some jpeg", "image/jpeg", "jpg"),
        (b"\x89PNG\r\n\x1a\n some png", "image/png", "png"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
@pytest.mark.parametrize("inject_session", [False, True])
def test_extract_images_formats(
    mock_dependencies: _Dependencies,
    image_bytes: bytes,
    expected_mime: str,
    expected_ext: str,
    inject_session: bool,
) -> None:
    # Mock page and image objects
    mock_page = MagicMock()
    mock_image_obj = MagicMock()

    def mock_extract(buf: io.BytesIO, **_kwargs: object) -> None:
        buf.write(image_bytes)

    mock_image_obj.extract.side_effect = mock_extract

    mock_page.get_objects.return_value = [mock_image_obj]

    extractor = pe.PdfExtractor(
        file_path="test.pdf",
        tenant_id=TENANT_ID,
        user_id=USER_ID,
        session=mock_dependencies.session if inject_session else None,
    )

    # We need to handle the import inside _extract_images
    with (
        patch("pypdfium2.raw", autospec=True) as mock_raw,
        patch.object(
            mock_dependencies.session,
            "commit",
            wraps=mock_dependencies.session.commit,
        ) as commit,
    ):
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1
        result = extractor._extract_images(mock_page)

    assert commit.called is not inject_session
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
@pytest.mark.usefixtures("mock_dependencies")
def test_extract_images_get_objects_scenarios(
    get_objects_side_effect: Exception | None,
    get_objects_return_value: list[object] | None,
) -> None:
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
@pytest.mark.usefixtures("mock_dependencies")
def test_extract_calls_extract_images(monkeypatch: pytest.MonkeyPatch) -> None:
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
            monkeypatch.setattr(extractor, "_extract_images", lambda _page, _page_number=0: "![image](img_url)")

            documents = list(extractor.extract())

            assert len(documents) == 1
            assert "Page text content" in documents[0].page_content
            assert "![image](img_url)" in documents[0].page_content
            assert documents[0].metadata["page"] == 0


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_failures(mock_dependencies: _Dependencies) -> None:
    # Mock page and image objects
    mock_page = MagicMock()
    mock_image_obj_fail = MagicMock()
    mock_image_obj_ok = MagicMock()

    # First image raises exception
    mock_image_obj_fail.extract.side_effect = Exception("Extraction failure")

    # Second image is OK (JPEG)
    jpeg_bytes = b"\xff\xd8\xff some image data"

    def mock_extract(buf: io.BytesIO, **_kwargs: object) -> None:
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


def test_extract_images_skipped_without_tenant_context() -> None:
    """PDFs loaded from a URL have no tenant/user context; image extraction must be skipped."""
    mock_page = MagicMock()

    extractor = pe.PdfExtractor(file_path="test.pdf")

    result = extractor._extract_images(mock_page)

    assert result == ""
    mock_page.get_objects.assert_not_called()


def _mock_image_page(image_bytes: bytes) -> MagicMock:
    mock_page = MagicMock()
    mock_image_obj = MagicMock()

    def mock_extract(buf: io.BytesIO, **_kwargs: object) -> None:
        buf.write(image_bytes)

    mock_image_obj.extract.side_effect = mock_extract
    mock_page.get_objects.return_value = [mock_image_obj]
    return mock_page


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_with_source_file_id_reuses_existing_assets(
    mock_dependencies: _Dependencies,
) -> None:
    """Repeated extraction of the same source must not accumulate duplicate assets."""
    source_file_id = str(uuid4())
    jpeg_bytes = b"\xff\xd8\xff some jpeg"
    mock_page = _mock_image_page(jpeg_bytes)

    with patch("pypdfium2.raw", autospec=True) as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1

        first_extractor = pe.PdfExtractor(
            file_path="test.pdf",
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            source_file_id=source_file_id,
        )
        first_link = first_extractor._extract_images(mock_page, 2)

        second_extractor = pe.PdfExtractor(
            file_path="test.pdf",
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            source_file_id=source_file_id,
        )
        second_link = second_extractor._extract_images(mock_page, 2)

    rows = mock_dependencies.session.scalars(select(UploadFile)).all()
    assert len(rows) == 1
    upload_file = rows[0]
    assert f"![image](http://files.local/files/{upload_file.id}/file-preview)" == first_link
    assert first_link == second_link
    # Storage must be written exactly once across both extractions.
    assert mock_dependencies.storage.saves == [(upload_file.key, jpeg_bytes)]
    # Deterministic key: tenant/source/page/index/content-hash.
    expected_hash = hashlib.sha256(jpeg_bytes).hexdigest()
    assert upload_file.key == (f"image_files/{TENANT_ID}/{source_file_id}/p2_i0_{expected_hash}.jpg")
    assert upload_file.hash == expected_hash


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_with_source_file_id_keeps_unique_keys_per_page(
    mock_dependencies: _Dependencies,
) -> None:
    """The same image content on different pages maps to distinct assets."""
    source_file_id = str(uuid4())
    jpeg_bytes = b"\xff\xd8\xff some jpeg"

    with patch("pypdfium2.raw", autospec=True) as mock_raw:
        mock_raw.FPDF_PAGEOBJ_IMAGE = 1

        extractor = pe.PdfExtractor(
            file_path="test.pdf",
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            source_file_id=source_file_id,
        )
        first_link = extractor._extract_images(_mock_image_page(jpeg_bytes), 0)
        second_link = extractor._extract_images(_mock_image_page(jpeg_bytes), 1)

    rows = mock_dependencies.session.scalars(select(UploadFile)).all()
    assert len(rows) == 2
    assert {row.key for row in rows} == {
        f"image_files/{TENANT_ID}/{source_file_id}/p0_i0_{hashlib.sha256(jpeg_bytes).hexdigest()}.jpg",
        f"image_files/{TENANT_ID}/{source_file_id}/p1_i0_{hashlib.sha256(jpeg_bytes).hexdigest()}.jpg",
    }
    assert first_link != second_link
    assert len(mock_dependencies.storage.saves) == 2
