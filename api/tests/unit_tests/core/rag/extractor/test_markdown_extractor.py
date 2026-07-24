from pathlib import Path
from types import SimpleNamespace

import pytest

import core.rag.extractor.markdown_extractor as markdown_module
from core.rag.extractor.markdown_extractor import MarkdownExtractor


class TestMarkdownExtractor:
    def test_markdown_to_tups(self):
        markdown = """
this is some text without header

# title 1
this is balabala text

## title 2
this is more specific text.
        """
        extractor = MarkdownExtractor(file_path="dummy_path")
        updated_output = extractor.markdown_to_tups(markdown)

        assert len(updated_output) == 3
        key, header_value = updated_output[0]
        assert key is None
        assert header_value.strip() == "this is some text without header"

        title_1, value = updated_output[1]
        assert title_1.strip() == "title 1"
        assert value.strip() == "this is balabala text"

    def test_markdown_to_tups_keeps_code_block_headers_literal(self):
        markdown = """# Header
before
```python
# this is not a heading
print('x')
```
after
"""
        extractor = MarkdownExtractor(file_path="dummy_path")

        tups = extractor.markdown_to_tups(markdown)

        assert len(tups) == 2
        assert tups[1][0] == "Header"
        assert "# this is not a heading" in tups[1][1]

    def test_remove_images_and_hyperlinks(self):
        extractor = MarkdownExtractor(file_path="dummy_path")

        with_images = "before ![[image.png]] after"
        with_links = "[OpenAI](https://openai.com)"

        assert extractor.remove_images(with_images) == "before  after"
        assert extractor.remove_hyperlinks(with_links) == "OpenAI"

    def test_parse_tups_reads_file_and_applies_options(self, tmp_path):
        markdown_file = tmp_path / "doc.md"
        markdown_file.write_text("# Header\nText with [link](https://example.com) and ![[img.png]]", encoding="utf-8")

        extractor = MarkdownExtractor(
            file_path=str(markdown_file),
            remove_hyperlinks=True,
            remove_images=True,
            autodetect_encoding=False,
        )

        tups = extractor.parse_tups(str(markdown_file))

        assert len(tups) == 2
        assert tups[1][0] == "Header"
        assert "[link]" not in tups[1][1]
        assert "img.png" not in tups[1][1]

    def test_parse_tups_autodetects_encoding_after_decode_error(self, monkeypatch):
        extractor = MarkdownExtractor(file_path="dummy_path", autodetect_encoding=True)

        calls: list[str | None] = []

        def fake_read_text(self, encoding=None):
            calls.append(encoding)
            if encoding is None:
                raise UnicodeDecodeError("utf-8", b"x", 0, 1, "fail")
            if encoding == "bad-encoding":
                raise UnicodeDecodeError("utf-8", b"x", 0, 1, "fail")
            return "# H\ncontent"

        monkeypatch.setattr(Path, "read_text", fake_read_text, raising=True)
        monkeypatch.setattr(
            markdown_module,
            "detect_file_encodings",
            lambda _: [SimpleNamespace(encoding="bad-encoding"), SimpleNamespace(encoding="utf-8")],
        )

        tups = extractor.parse_tups("dummy_path")

        assert len(tups) == 2
        assert calls == [None, "bad-encoding", "utf-8"]

    def test_parse_tups_decode_error_with_autodetect_disabled_raises(self, monkeypatch):
        extractor = MarkdownExtractor(file_path="dummy_path", autodetect_encoding=False)

        def raise_decode(self, encoding=None):
            raise UnicodeDecodeError("utf-8", b"x", 0, 1, "fail")

        monkeypatch.setattr(Path, "read_text", raise_decode, raising=True)

        with pytest.raises(RuntimeError, match="Error loading dummy_path"):
            extractor.parse_tups("dummy_path")

    def test_parse_tups_other_exceptions_are_wrapped(self, monkeypatch):
        extractor = MarkdownExtractor(file_path="dummy_path")

        def raise_other(self, encoding=None):
            raise OSError("disk error")

        monkeypatch.setattr(Path, "read_text", raise_other, raising=True)

        with pytest.raises(RuntimeError, match="Error loading dummy_path"):
            extractor.parse_tups("dummy_path")

    def test_extract_builds_documents_for_header_and_non_header(self, monkeypatch):
        extractor = MarkdownExtractor(file_path="dummy_path")
        monkeypatch.setattr(extractor, "parse_tups", lambda _: [(None, "plain"), ("Header", "value")])

        docs = extractor.extract()

        assert [doc.page_content for doc in docs] == ["plain", "\n\nHeader\nvalue"]
