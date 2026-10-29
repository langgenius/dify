import hashlib
import io
from collections.abc import Iterator
from contextlib import closing
from dataclasses import dataclass
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pypdfium2
import pytest
from PIL import Image
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


@pytest.fixture
def image_pdf() -> Iterator[tuple[pypdfium2.PdfDocument, bytes]]:
    """Build real PDF pages so image extraction exercises PDFium, too."""
    image_buffer = io.BytesIO()
    with Image.new("RGB", (8, 8), "red") as image:
        image.save(image_buffer, format="JPEG")
    image_bytes = image_buffer.getvalue()

    with pypdfium2.PdfDocument.new() as pdf:
        for _ in range(2):
            with closing(pdf.new_page(100, 100)) as page:
                image_object = pypdfium2.PdfImage.new(pdf)
                image_object.load_jpeg(io.BytesIO(image_bytes), inline=True)
                page.insert_obj(image_object)
                page.gen_content()
        yield pdf, image_bytes


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
@pytest.mark.parametrize("inject_session", [False, True])
def test_extract_images_with_source_file_id_reuses_existing_assets(
    mock_dependencies: _Dependencies,
    image_pdf: tuple[pypdfium2.PdfDocument, bytes],
    inject_session: bool,
) -> None:
    """Repeated extraction of the same source must not accumulate duplicate assets."""
    source_file_id = str(uuid4())
    pdf, jpeg_bytes = image_pdf

    with closing(pdf[0]) as page:
        first_extractor = pe.PdfExtractor(
            file_path="test.pdf",
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            source_file_id=source_file_id,
            session=mock_dependencies.session if inject_session else None,
        )
        first_link = first_extractor._extract_images(page, 2)

        second_extractor = pe.PdfExtractor(
            file_path="test.pdf",
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            source_file_id=source_file_id,
            session=mock_dependencies.session if inject_session else None,
        )
        second_link = second_extractor._extract_images(page, 2)

    rows = mock_dependencies.session.scalars(select(UploadFile)).all()
    assert len(rows) == 1
    upload_file = rows[0]
    assert f"![image](http://files.local/files/{upload_file.id}/file-preview)" == first_link
    assert first_link == second_link
    assert mock_dependencies.storage.saves == [(upload_file.key, jpeg_bytes)]
    expected_hash = hashlib.sha256(jpeg_bytes).hexdigest()
    assert upload_file.key == f"image_files/{TENANT_ID}/{source_file_id}/p2_0_{expected_hash}.jpg"
    assert upload_file.hash == expected_hash


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
def test_extract_images_with_source_file_id_keeps_unique_keys_per_page(
    mock_dependencies: _Dependencies,
    image_pdf: tuple[pypdfium2.PdfDocument, bytes],
) -> None:
    """The same image content on different pages maps to distinct assets."""
    source_file_id = str(uuid4())
    pdf, jpeg_bytes = image_pdf
    extractor = pe.PdfExtractor(
        file_path="test.pdf",
        tenant_id=TENANT_ID,
        user_id=USER_ID,
        source_file_id=source_file_id,
    )
    with closing(pdf[0]) as first_page, closing(pdf[1]) as second_page:
        first_link = extractor._extract_images(first_page, 0)
        second_link = extractor._extract_images(second_page, 1)

    rows = mock_dependencies.session.scalars(select(UploadFile)).all()
    assert len(rows) == 2
    assert {row.key for row in rows} == {
        f"image_files/{TENANT_ID}/{source_file_id}/p0_0_{hashlib.sha256(jpeg_bytes).hexdigest()}.jpg",
        f"image_files/{TENANT_ID}/{source_file_id}/p1_0_{hashlib.sha256(jpeg_bytes).hexdigest()}.jpg",
    }
    assert first_link != second_link
    assert len(mock_dependencies.storage.saves) == 2


@pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
@pytest.mark.parametrize("inject_session", [False, True])
@pytest.mark.parametrize("fail_all", [False, True])
def test_extract_images_storage_failure_isolated_and_retryable(
    mock_dependencies: _Dependencies,
    image_pdf: tuple[pypdfium2.PdfDocument, bytes],
    monkeypatch: pytest.MonkeyPatch,
    inject_session: bool,
    fail_all: bool,
) -> None:
    """Failed saves create no rows; other images and later retries still succeed."""
    pdf, jpeg_bytes = image_pdf
    source_file_id = str(uuid4())
    extractor = pe.PdfExtractor(
        file_path="test.pdf",
        tenant_id=TENANT_ID,
        user_id=USER_ID,
        source_file_id=source_file_id,
        session=mock_dependencies.session if inject_session else None,
    )
    save = mock_dependencies.storage.save
    attempts = 0

    def fail_save(key: str, data: bytes) -> None:
        nonlocal attempts
        attempts += 1
        if fail_all or attempts == 1:
            raise OSError("Storage unavailable")
        save(key, data)

    with closing(pdf[0]) as page:
        image_object = pypdfium2.PdfImage.new(pdf)
        image_object.load_jpeg(io.BytesIO(jpeg_bytes), inline=True)
        page.insert_obj(image_object)
        page.gen_content()
        monkeypatch.setattr(mock_dependencies.storage, "save", fail_save)
        first_result = extractor._extract_images(page)

        rows = mock_dependencies.session.scalars(select(UploadFile)).all()
        assert attempts == 2
        assert len(rows) == (0 if fail_all else 1)
        assert len(mock_dependencies.storage.saves) == len(rows)
        if fail_all:
            assert first_result == ""
        else:
            assert first_result == f"![image](http://files.local/files/{rows[0].id}/file-preview)"
            assert "/p0_1_" in rows[0].key

        monkeypatch.setattr(mock_dependencies.storage, "save", save)
        retry_result = extractor._extract_images(page)
        assert extractor._extract_images(page) == retry_result

    rows = mock_dependencies.session.scalars(select(UploadFile)).all()
    assert len(rows) == 2
    assert len(mock_dependencies.storage.saves) == 2
    assert retry_result.count("![image]") == 2
    for row in rows:
        assert f"/files/{row.id}/file-preview" in retry_result
