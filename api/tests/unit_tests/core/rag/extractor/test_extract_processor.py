from pathlib import Path
from types import SimpleNamespace

import pytest

import core.rag.extractor.extract_processor as processor_module
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.models.document import Document


class _ExtractorFactory:
    def __init__(self) -> None:
        self.calls = []

    def make(self, name: str) -> type[object]:
        calls = self.calls

        class DummyExtractor:
            def __init__(self, *args, **kwargs):
                calls.append((name, args, kwargs))

            def extract(self):
                return [Document(page_content=f"extracted-by-{name}")]

        return DummyExtractor


def _patch_all_extractors(monkeypatch) -> _ExtractorFactory:
    factory = _ExtractorFactory()

    for cls_name in [
        "CSVExtractor",
        "ExcelExtractor",
        "FirecrawlWebExtractor",
        "HtmlExtractor",
        "JinaReaderWebExtractor",
        "MarkdownExtractor",
        "NotionExtractor",
        "PdfExtractor",
        "TextExtractor",
        "UnstructuredEmailExtractor",
        "UnstructuredEpubExtractor",
        "UnstructuredMarkdownExtractor",
        "UnstructuredMsgExtractor",
        "UnstructuredPPTExtractor",
        "UnstructuredPPTXExtractor",
        "UnstructuredWordExtractor",
        "UnstructuredXmlExtractor",
        "WaterCrawlWebExtractor",
        "WordExtractor",
    ]:
        monkeypatch.setattr(processor_module, cls_name, factory.make(cls_name))

    return factory


class TestExtractProcessorLoaders:
    def test_load_from_upload_file_return_docs_and_text(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(processor_module, "ExtractSetting", lambda **kwargs: SimpleNamespace(**kwargs))

        monkeypatch.setattr(
            ExtractProcessor,
            "extract",
            lambda extract_setting, is_automatic=False, file_path=None: [
                Document(page_content="doc-1"),
                Document(page_content="doc-2"),
            ],
        )

        upload_file = SimpleNamespace(key="file.txt")

        docs = ExtractProcessor.load_from_upload_file(upload_file=upload_file, return_text=False)
        text = ExtractProcessor.load_from_upload_file(upload_file=upload_file, return_text=True)

        assert len(docs) == 2
        assert text == "doc-1\ndoc-2"

    @pytest.mark.parametrize(
        ("url", "headers", "expected_suffix"),
        [
            ("https://example.com/file.txt", {"Content-Type": "text/plain"}, ".txt"),
            ("https://example.com/no_suffix", {"Content-Type": "application/pdf"}, ".pdf"),
            (
                "https://example.com/no_suffix",
                {"Content-Disposition": 'attachment; filename="report.md"'},
                ".md",
            ),
            (
                "https://example.com/no_suffix",
                {"Content-Disposition": 'attachment; filename="report"'},
                "",
            ),
        ],
    )
    def test_load_from_url_builds_temp_file_with_correct_suffix(
        self, monkeypatch: pytest.MonkeyPatch, url, headers, expected_suffix
    ):
        response = SimpleNamespace(headers=headers, content=b"body")
        monkeypatch.setattr(processor_module.ssrf_proxy, "get", lambda *args, **kwargs: response)
        monkeypatch.setattr(processor_module, "ExtractSetting", lambda **kwargs: SimpleNamespace(**kwargs))

        captured = {}

        def fake_extract(extract_setting, is_automatic=False, file_path=None):
            key = "file_path_docs" if "file_path_docs" not in captured else "file_path_text"
            captured[key] = file_path
            return [Document(page_content="u1"), Document(page_content="u2")]

        monkeypatch.setattr(ExtractProcessor, "extract", fake_extract)

        docs = ExtractProcessor.load_from_url(url, return_text=False)
        assert captured["file_path_docs"].endswith(expected_suffix)

        text = ExtractProcessor.load_from_url(url, return_text=True)
        assert captured["file_path_text"].endswith(expected_suffix)

        assert len(docs) == 2
        assert text == "u1\nu2"


class TestExtractProcessorFileRouting:
    @pytest.fixture(autouse=True)
    def _set_unstructured_config(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(processor_module.dify_config, "UNSTRUCTURED_API_URL", "https://unstructured")
        monkeypatch.setattr(processor_module.dify_config, "UNSTRUCTURED_API_KEY", "key")

    def _run_extract_for_extension(
        self, monkeypatch: pytest.MonkeyPatch, extension: str, etl_type: str, is_automatic: bool = False
    ):
        factory = _patch_all_extractors(monkeypatch)
        monkeypatch.setattr(processor_module.dify_config, "ETL_TYPE", etl_type)

        def fake_download(key: str, local_path: str):
            Path(local_path).write_text("content", encoding="utf-8")

        monkeypatch.setattr(processor_module.storage, "download", fake_download)
        monkeypatch.setattr(processor_module.tempfile, "_get_candidate_names", lambda: iter(["candidate-name"]))

        setting = SimpleNamespace(
            datasource_type=DatasourceType.FILE,
            upload_file=SimpleNamespace(key=f"uploaded{extension}", tenant_id="tenant-1", created_by="user-1"),
        )

        docs = ExtractProcessor.extract(setting, is_automatic=is_automatic)

        assert len(docs) == 1
        assert docs[0].page_content.startswith("extracted-by-")
        return factory.calls[-1][0], factory.calls[-1][1], factory.calls[-1][2]

    @pytest.mark.parametrize(
        ("extension", "expected_extractor", "is_automatic"),
        [
            (".xlsx", "ExcelExtractor", False),
            (".xls", "ExcelExtractor", False),
            (".pdf", "PdfExtractor", False),
            (".md", "UnstructuredMarkdownExtractor", True),
            (".mdx", "MarkdownExtractor", False),
            (".htm", "HtmlExtractor", False),
            (".html", "HtmlExtractor", False),
            (".docx", "WordExtractor", False),
            (".doc", "UnstructuredWordExtractor", False),
            (".csv", "CSVExtractor", False),
            (".msg", "UnstructuredMsgExtractor", False),
            (".eml", "UnstructuredEmailExtractor", False),
            (".ppt", "UnstructuredPPTExtractor", False),
            (".pptx", "UnstructuredPPTXExtractor", False),
            (".xml", "UnstructuredXmlExtractor", False),
            (".epub", "UnstructuredEpubExtractor", False),
            (".txt", "TextExtractor", False),
        ],
    )
    def test_extract_routes_file_extensions_for_unstructured_mode(
        self, monkeypatch: pytest.MonkeyPatch, extension, expected_extractor, is_automatic
    ):
        extractor_name, args, kwargs = self._run_extract_for_extension(
            monkeypatch, extension, etl_type="Unstructured", is_automatic=is_automatic
        )

        assert extractor_name == expected_extractor
        assert args

    @pytest.mark.parametrize(
        ("extension", "expected_extractor"),
        [
            (".xlsx", "ExcelExtractor"),
            (".pdf", "PdfExtractor"),
            (".markdown", "MarkdownExtractor"),
            (".html", "HtmlExtractor"),
            (".docx", "WordExtractor"),
            (".csv", "CSVExtractor"),
            (".epub", "UnstructuredEpubExtractor"),
            (".txt", "TextExtractor"),
        ],
    )
    def test_extract_routes_file_extensions_for_default_mode(
        self, monkeypatch: pytest.MonkeyPatch, extension, expected_extractor
    ):
        extractor_name, _, _ = self._run_extract_for_extension(monkeypatch, extension, etl_type="SelfHosted")

        assert extractor_name == expected_extractor

    def test_extract_requires_upload_file_when_file_path_not_provided(self):
        setting = SimpleNamespace(datasource_type=DatasourceType.FILE, upload_file=None)

        with pytest.raises(AssertionError, match="upload_file is required"):
            ExtractProcessor.extract(setting)


class TestExtractProcessorDatasourceRouting:
    def test_extract_routes_notion_datasource(self, monkeypatch: pytest.MonkeyPatch):
        factory = _patch_all_extractors(monkeypatch)

        notion_info = SimpleNamespace(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            document="doc",
            tenant_id="tenant",
            credential_id="cred",
        )
        setting = SimpleNamespace(datasource_type=DatasourceType.NOTION, notion_info=notion_info)

        docs = ExtractProcessor.extract(setting)

        assert docs[0].page_content == "extracted-by-NotionExtractor"
        assert factory.calls[-1][0] == "NotionExtractor"

    @pytest.mark.parametrize(
        ("provider", "expected"),
        [
            ("firecrawl", "FirecrawlWebExtractor"),
            ("watercrawl", "WaterCrawlWebExtractor"),
            ("jinareader", "JinaReaderWebExtractor"),
        ],
    )
    def test_extract_routes_website_datasource_providers(
        self, monkeypatch: pytest.MonkeyPatch, provider: str, expected: str
    ):
        factory = _patch_all_extractors(monkeypatch)

        website_info = SimpleNamespace(
            provider=provider,
            url="https://example.com",
            job_id="job",
            tenant_id="tenant",
            mode="crawl",
            only_main_content=True,
        )
        setting = SimpleNamespace(datasource_type=DatasourceType.WEBSITE, website_info=website_info)

        docs = ExtractProcessor.extract(setting)
        assert docs[0].page_content == f"extracted-by-{expected}"
        assert factory.calls[-1][0] == expected

    def test_extract_unsupported_website_provider(self):
        bad_provider = SimpleNamespace(
            provider="unknown",
            url="https://example.com",
            job_id="job",
            tenant_id="tenant",
            mode="crawl",
            only_main_content=True,
        )
        setting = SimpleNamespace(datasource_type=DatasourceType.WEBSITE, website_info=bad_provider)

        with pytest.raises(ValueError, match="Unsupported website provider"):
            ExtractProcessor.extract(setting)

    def test_extract_unsupported_datasource_type(self):
        with pytest.raises(ValueError, match="Unsupported datasource type"):
            ExtractProcessor.extract(SimpleNamespace(datasource_type="unknown"))

    def test_extract_requires_notion_info(self):
        with pytest.raises(AssertionError, match="notion_info is required"):
            ExtractProcessor.extract(SimpleNamespace(datasource_type=DatasourceType.NOTION, notion_info=None))

    def test_extract_requires_website_info(self):
        with pytest.raises(AssertionError, match="website_info is required"):
            ExtractProcessor.extract(SimpleNamespace(datasource_type=DatasourceType.WEBSITE, website_info=None))
