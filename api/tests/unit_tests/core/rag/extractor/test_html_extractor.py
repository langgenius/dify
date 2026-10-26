from pathlib import Path

import pytest

from core.rag.extractor.html_extractor import HtmlExtractor


class TestHtmlExtractor:
    def test_extract_returns_text_content(self, tmp_path: Path):
        file_path = tmp_path / "sample.html"
        file_path.write_text("<html><body><h1>Title</h1><p>Hello</p></body></html>", encoding="utf-8")

        extractor = HtmlExtractor(str(file_path))
        docs = extractor.extract()

        assert len(docs) == 1
        assert "".join(docs[0].page_content.split()) == "TitleHello"

    def test_block_elements_do_not_run_together(self, tmp_path: Path):
        """The markup is the only place a block boundary exists."""
        file_path = tmp_path / "sample.html"
        file_path.write_text(
            "<html><body><h1>Quarterly Report</h1><p>Revenue rose.</p>"
            "<p>Costs fell.</p><ul><li>Item one</li><li>Item two</li></ul></body></html>",
            encoding="utf-8",
        )

        text = HtmlExtractor(str(file_path))._load_as_text()

        assert text == "Quarterly Report\nRevenue rose.\nCosts fell.\nItem one\nItem two"

    def test_inline_elements_keep_the_sentence_intact(self, tmp_path: Path):
        """A separator passed to get_text() would fix the blocks and break this."""
        file_path = tmp_path / "sample.html"
        file_path.write_text(
            '<html><body><p>Hello <b>world</b>! See <a href="#">this</a>.</p></body></html>',
            encoding="utf-8",
        )

        assert HtmlExtractor(str(file_path))._load_as_text() == "Hello world! See this."

    def test_the_title_reads_as_its_own_line(self, tmp_path: Path):
        """Not a block, but it is a line once the document is flattened."""
        file_path = tmp_path / "sample.html"
        file_path.write_text(
            "<html><head><title>Test Page</title></head><body><p>Body text</p></body></html>",
            encoding="utf-8",
        )

        assert HtmlExtractor(str(file_path))._load_as_text() == "Test Page\nBody text"

    def test_a_line_break_element_becomes_a_line_break(self, tmp_path: Path):
        file_path = tmp_path / "sample.html"
        file_path.write_text("<html><body><p>line one<br>line two</p></body></html>", encoding="utf-8")

        assert HtmlExtractor(str(file_path))._load_as_text() == "line one\nline two"

    def test_script_and_style_text_stays_out(self, tmp_path: Path):
        file_path = tmp_path / "sample.html"
        file_path.write_text(
            "<html><head><style>.a{color:red}</style></head><body><p>kept</p><script>var a = 1;</script></body></html>",
            encoding="utf-8",
        )

        assert HtmlExtractor(str(file_path))._load_as_text() == "kept"

    @pytest.mark.timeout(10)
    def test_many_line_breaks_are_read_in_linear_time(self, tmp_path: Path):
        """Replacing each <br> in place scans its siblings every time: 50,000 of
        them in one element took about a minute."""
        file_path = tmp_path / "sample.html"
        file_path.write_text("<html><body><div>" + "x<br>" * 50_000 + "</div></body></html>", encoding="utf-8")

        lines = HtmlExtractor(str(file_path))._load_as_text().split("\n")

        assert len(lines) == 50_000
        assert set(lines) == {"x"}

    def test_load_as_text_strips_whitespace_and_handles_empty(self, tmp_path: Path):
        file_path = tmp_path / "sample.html"
        file_path.write_text("<html><body>   \n  </body></html>", encoding="utf-8")

        extractor = HtmlExtractor(str(file_path))

        assert extractor._load_as_text() == ""
