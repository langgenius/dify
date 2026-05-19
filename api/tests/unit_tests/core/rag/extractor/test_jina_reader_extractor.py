from pytest_mock import MockerFixture

from core.rag.extractor.jina_reader_extractor import JinaReaderWebExtractor


class TestJinaReaderWebExtractor:
    def test_extract_crawl_mode_returns_document(self, mocker: MockerFixture):
        mocker.patch(
            "core.rag.extractor.jina_reader_extractor.WebsiteService.get_crawl_url_data",
            return_value={
                "content": "markdown-content",
                "url": "https://example.com",
                "description": "desc",
                "title": "title",
            },
        )

        extractor = JinaReaderWebExtractor("https://example.com", "job-1", "tenant-1", mode="crawl")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "markdown-content"
        assert docs[0].metadata == {
            "source_url": "https://example.com",
            "description": "desc",
            "title": "title",
        }

    def test_extract_crawl_mode_with_missing_data_returns_empty(self, mocker: MockerFixture):
        mocker.patch(
            "core.rag.extractor.jina_reader_extractor.WebsiteService.get_crawl_url_data",
            return_value=None,
        )

        extractor = JinaReaderWebExtractor("https://example.com", "job-1", "tenant-1", mode="crawl")

        assert extractor.extract() == []

    def test_extract_non_crawl_mode_returns_empty(self, mocker: MockerFixture):
        mock_get_crawl = mocker.patch(
            "core.rag.extractor.jina_reader_extractor.WebsiteService.get_crawl_url_data",
            return_value={"content": "unused"},
        )
        extractor = JinaReaderWebExtractor("https://example.com", "job-1", "tenant-1", mode="scrape")

        assert extractor.extract() == []
        mock_get_crawl.assert_not_called()
