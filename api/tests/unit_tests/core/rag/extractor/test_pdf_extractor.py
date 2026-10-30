import io
from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import pytest

import core.rag.extractor.pdf_extractor as pe
from core.rag.models.document import Document
from services.extraction.contracts import ExtractedImage, ImageReference


class _ImageWriter:
    def __init__(self) -> None:
        self.calls: list[ExtractedImage] = []

    def write(self, image: ExtractedImage) -> ImageReference:
        self.calls.append(image)
        return ImageReference(preview_url=f"http://files.local/files/image-{len(self.calls)}/file-preview")


def _image_object(content: bytes) -> MagicMock:
    image = MagicMock()

    def extract(target: io.BytesIO, **_kwargs: object) -> None:
        target.write(content)

    image.extract.side_effect = extract
    return image


@pytest.mark.parametrize(
    ("image_bytes", "expected_mime", "expected_ext"),
    [
        (b"\xff\xd8\xff some jpeg", "image/jpeg", "jpg"),
        (b"\x89PNG\r\n\x1a\n some png", "image/png", "png"),
    ],
)
def test_extract_images_formats(image_bytes: bytes, expected_mime: str, expected_ext: str) -> None:
    page = MagicMock()
    page.get_objects.return_value = [_image_object(image_bytes)]
    writer = _ImageWriter()
    extractor = pe.PdfExtractor(file_path="test.pdf", image_writer=writer)

    result = extractor._extract_images(page)

    assert result == "![image](http://files.local/files/image-1/file-preview)"
    assert writer.calls == [ExtractedImage(content=image_bytes, extension=expected_ext, mime_type=expected_mime)]


@pytest.mark.parametrize(
    ("get_objects_side_effect", "get_objects_return_value"),
    [
        (None, []),
        (None, None),
        (Exception("Failed to get objects"), None),
    ],
)
def test_extract_images_get_objects_scenarios(
    get_objects_side_effect: Exception | None,
    get_objects_return_value: list[object] | None,
) -> None:
    page = MagicMock()
    if get_objects_side_effect:
        page.get_objects.side_effect = get_objects_side_effect
    else:
        page.get_objects.return_value = get_objects_return_value
    writer = _ImageWriter()
    extractor = pe.PdfExtractor(file_path="test.pdf", image_writer=writer)

    assert extractor._extract_images(page) == ""
    assert writer.calls == []


def test_extract_calls_extract_images_and_closes_pdf_resources(monkeypatch: pytest.MonkeyPatch) -> None:
    pdf = MagicMock()
    page = MagicMock()
    pdf.__iter__.return_value = [page]
    text_page = MagicMock()
    text_page.get_text_range.return_value = "Page text content"
    page.get_textpage.return_value = text_page
    blob = MagicMock()
    blob.source = "test.pdf"
    writer = _ImageWriter()

    with (
        patch("pypdfium2.PdfDocument", return_value=pdf, autospec=True),
        patch("core.rag.extractor.pdf_extractor.Blob.from_path", return_value=blob, autospec=True),
    ):
        extractor = pe.PdfExtractor(file_path="test.pdf", image_writer=writer)
        monkeypatch.setattr(extractor, "_extract_images", lambda _page: "![image](img_url)")
        documents = extractor.extract()

    assert documents == [
        Document(page_content="Page text content\n![image](img_url)", metadata={"source": "test.pdf", "page": 0})
    ]
    text_page.close.assert_called_once_with()
    page.close.assert_called_once_with()
    pdf.close.assert_called_once_with()


def test_extract_images_skips_parser_failure_and_keeps_valid_image() -> None:
    failed = MagicMock()
    failed.extract.side_effect = RuntimeError("Extraction failure")
    jpeg_bytes = b"\xff\xd8\xff some image data"
    page = MagicMock()
    page.get_objects.return_value = [failed, _image_object(jpeg_bytes)]
    writer = _ImageWriter()
    extractor = pe.PdfExtractor(file_path="test.pdf", image_writer=writer)

    result = extractor._extract_images(page)

    assert result == "![image](http://files.local/files/image-1/file-preview)"
    assert writer.calls == [ExtractedImage(content=jpeg_bytes, extension="jpg", mime_type="image/jpeg")]


def test_image_writer_failure_propagates() -> None:
    image_bytes = b"\x89PNG\r\n\x1a\nimage"

    class Page:
        def get_objects(self, **_kwargs: object) -> list[MagicMock]:
            return [_image_object(image_bytes)]

    class FailingWriter:
        def write(self, image: ExtractedImage) -> ImageReference:
            assert image.content == image_bytes
            raise RuntimeError("storage response lost")

    extractor = pe.PdfExtractor(file_path="test.pdf", image_writer=FailingWriter())

    with pytest.raises(RuntimeError) as raised:
        extractor._extract_images(Page())
    assert isinstance(raised.value.__cause__, RuntimeError)
    assert str(raised.value.__cause__) == "storage response lost"


def test_text_only_extraction_skips_pdf_images(monkeypatch: pytest.MonkeyPatch) -> None:
    class TextPage:
        def get_text_range(self) -> str:
            return "preview text"

        def close(self) -> None:
            pass

    class Page:
        def get_textpage(self) -> TextPage:
            return TextPage()

        def close(self) -> None:
            pass

    class PdfDocument:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def __iter__(self) -> Iterator[Page]:
            return iter([Page()])

        def close(self) -> None:
            pass

    class Blob:
        source = "preview.pdf"

        def as_bytes_io(self) -> io.BytesIO:
            return io.BytesIO(b"pdf")

    extractor = pe.PdfExtractor(file_path="preview.pdf")

    def fail_if_called(_page: object) -> str:
        pytest.fail("text-only extraction must not persist PDF images")

    monkeypatch.setattr(pe.pypdfium2, "PdfDocument", PdfDocument)
    monkeypatch.setattr(extractor, "_extract_images", fail_if_called)

    documents = list(extractor.parse(Blob()))  # type: ignore[arg-type]

    assert documents == [Document(page_content="preview text", metadata={"source": "preview.pdf", "page": 0})]
