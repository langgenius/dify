from core.rag.extractor.html_extractor import HtmlExtractor


class TestHtmlExtractor:
    def test_extract_returns_text_content(self, tmp_path):
        file_path = tmp_path / "sample.html"
        file_path.write_text("<html><body><h1>Title</h1><p>Hello</p></body></html>", encoding="utf-8")

        extractor = HtmlExtractor(str(file_path))
        docs = extractor.extract()

        assert len(docs) == 1
        assert "".join(docs[0].page_content.split()) == "TitleHello"

    def test_load_as_text_strips_whitespace_and_handles_empty(self, tmp_path):
        file_path = tmp_path / "sample.html"
        file_path.write_text("<html><body>   \n  </body></html>", encoding="utf-8")

        extractor = HtmlExtractor(str(file_path))

        assert extractor._load_as_text() == ""
