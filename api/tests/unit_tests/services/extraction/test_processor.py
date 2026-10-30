from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import cast
from unittest.mock import Mock, create_autospec

import httpx
import pytest

import services.extraction.processor as processor_module
from core.rag.models.document import Document
from models.model import UploadFile
from services.data_source.entities.website import WebsiteJobRef
from services.data_source.website_service import WebsiteService
from services.extraction.contracts import (
    DatasourceType,
    ExtractedImage,
    ExtractionResult,
    ExtractSetting,
    ImageReference,
    ImageWriter,
    NotionInfo,
    WebsiteInfo,
)
from services.extraction.processor import ExtractProcessor
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_upload_file


def _upload_file(*, key: str, file_id: str = "upload-file-1") -> UploadFile:
    return make_upload_file(
        file_id=file_id,
        key=key,
        name=Path(key).name,
        size=1,
        extension=Path(key).suffix.lstrip("."),
        mime_type="application/octet-stream",
        created_by="user-1",
        created_at=datetime(2025, 1, 1),
        used=True,
    )


class _ExtractorFactory:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []
        self.events: list[str] = []

    def make(self, name: str) -> type[object]:
        calls = self.calls
        events = self.events

        class DummyExtractor:
            def __init__[**P](self, *args: P.args, **kwargs: P.kwargs) -> None:
                calls.append((name, args, kwargs))

            def extract(self) -> list[Document]:
                events.append(f"{name}.extract")
                return [Document(page_content=f"extracted-by-{name}")]

            def get_notion_last_edited_time(self) -> str:
                events.append(f"{name}.source_version")
                return "2026-10-24T00:00:00Z"

        return DummyExtractor


def _patch_all_extractors(monkeypatch: pytest.MonkeyPatch) -> _ExtractorFactory:
    factory = _ExtractorFactory()

    for cls_name in [
        "CSVExtractor",
        "ExcelExtractor",
        "HtmlExtractor",
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
        "WordExtractor",
    ]:
        monkeypatch.setattr(processor_module, cls_name, factory.make(cls_name))

    return factory


class _ImageWriter:
    def __init__(self) -> None:
        self.calls: list[ExtractedImage] = []

    def write(self, image: ExtractedImage) -> ImageReference:
        self.calls.append(image)
        return ImageReference(preview_url="/files/created-upload-1/preview")


class TestExtractProcessorLoaders:
    @pytest.mark.parametrize(
        ("url", "headers", "expected_suffix"),
        [
            ("https://example.com/file.txt", {"Content-Type": "text/plain"}, ".txt"),
            ("https://example.com/no_suffix", {"Content-Type": "application/pdf"}, ".pdf"),
            (
                "https://example.com/no_suffix",
                {"Content-Type": "application/pdf; charset=binary"},
                ".pdf",
            ),
            (
                "https://example.com/no_suffix",
                {"Content-Type": "text/html; charset=utf-8"},
                ".html",
            ),
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
            ("https://example.com/no_suffix", {}, ""),
        ],
    )
    def test_load_from_url_builds_temp_file_with_correct_suffix(
        self,
        monkeypatch: pytest.MonkeyPatch,
        url: str,
        headers: dict[str, str],
        expected_suffix: str,
    ) -> None:
        response = httpx.Response(200, headers=headers, content=b"body")
        monkeypatch.setattr(processor_module.remote_fetcher, "make_request", lambda *_args, **_kwargs: response)

        captured: dict[str, str | None] = {}

        def fake_extract(
            extract_setting: ExtractSetting,
            is_automatic: bool = False,
            file_path: str | None = None,
            **_kwargs: object,
        ) -> ExtractionResult[Document]:
            del extract_setting, is_automatic
            key = "file_path_docs" if "file_path_docs" not in captured else "file_path_text"
            captured[key] = file_path
            return ExtractionResult[Document](documents=[Document(page_content="u1"), Document(page_content="u2")])

        monkeypatch.setattr(ExtractProcessor, "extract", fake_extract)

        docs = ExtractProcessor.load_from_url(url, return_text=False)
        file_path_docs = captured["file_path_docs"]
        assert file_path_docs is not None
        assert file_path_docs.endswith(expected_suffix)

        text = ExtractProcessor.load_from_url(url, return_text=True)
        file_path_text = captured["file_path_text"]
        assert file_path_text is not None
        assert file_path_text.endswith(expected_suffix)

        assert len(docs) == 2
        assert text == "u1\nu2"

    def test_load_from_url_extracts_long_text_without_upload_file(self, monkeypatch: pytest.MonkeyPatch) -> None:
        content = "a" * 100_000
        response = httpx.Response(200, headers={"Content-Type": "text/plain"}, content=content.encode())
        monkeypatch.setattr(processor_module.remote_fetcher, "make_request", lambda *_args, **_kwargs: response)
        apply_config_overrides(monkeypatch, ETL_TYPE="SelfHosted")

        text = ExtractProcessor.load_from_url("https://example.com/response.txt", return_text=True)

        assert text == content

    def test_load_from_url_extracts_pdf_without_upload_file(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = httpx.Response(200, headers={"Content-Type": "application/pdf"}, content=b"%PDF-1.1 body")
        monkeypatch.setattr(processor_module.remote_fetcher, "make_request", lambda *_args, **_kwargs: response)
        factory = _patch_all_extractors(monkeypatch)
        apply_config_overrides(monkeypatch, ETL_TYPE="dify")

        text = ExtractProcessor.load_from_url("https://example.com/report", return_text=True)

        assert text == "extracted-by-PdfExtractor"
        name, args, kwargs = factory.calls[-1]
        assert name == "PdfExtractor"
        assert len(args) == 1
        assert kwargs == {"image_writer": None}

    def test_load_from_url_routes_parameterized_content_type(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Servers commonly append parameters such as "; charset=binary" to
        # Content-Type; the media type must be parsed before deriving the suffix.
        response = httpx.Response(
            200,
            headers={"Content-Type": "application/pdf; charset=binary"},
            content=b"%PDF-1.1 body",
        )
        monkeypatch.setattr(processor_module.remote_fetcher, "make_request", lambda *_args, **_kwargs: response)
        factory = _patch_all_extractors(monkeypatch)
        apply_config_overrides(monkeypatch, ETL_TYPE="dify")

        text = ExtractProcessor.load_from_url("https://example.com/report", return_text=True)

        assert text == "extracted-by-PdfExtractor"
        assert factory.calls[-1][0] == "PdfExtractor"


class TestExtractProcessorFileRouting:
    @pytest.fixture(autouse=True)
    def _set_unstructured_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(
            monkeypatch,
            UNSTRUCTURED_API_URL="https://unstructured",
            UNSTRUCTURED_API_KEY="key",
        )

    def _run_extract_for_extension(
        self,
        monkeypatch: pytest.MonkeyPatch,
        extension: str,
        etl_type: str,
        is_automatic: bool = False,
        image_writer: ImageWriter | None = None,
    ) -> tuple[str, tuple[object, ...], dict[str, object]]:
        factory = _patch_all_extractors(monkeypatch)
        apply_config_overrides(monkeypatch, ETL_TYPE=etl_type)

        def fake_download(_key: str, local_path: str) -> None:
            Path(local_path).write_text("content", encoding="utf-8")

        monkeypatch.setattr(processor_module.storage, "download", fake_download)
        monkeypatch.setattr(processor_module.tempfile, "_get_candidate_names", lambda: iter(["candidate-name"]))

        setting = ExtractSetting(
            datasource_type=DatasourceType.FILE,
            upload_file=_upload_file(key=f"uploaded{extension}"),
        )

        result = ExtractProcessor.extract(
            setting,
            is_automatic=is_automatic,
            image_writer=image_writer,
        )

        assert len(result.documents) == 1
        assert result.documents[0].page_content.startswith("extracted-by-")
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
        self,
        monkeypatch: pytest.MonkeyPatch,
        extension: str,
        expected_extractor: str,
        is_automatic: bool,
    ) -> None:
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
        self, monkeypatch: pytest.MonkeyPatch, extension: str, expected_extractor: str
    ) -> None:
        extractor_name, _, _ = self._run_extract_for_extension(monkeypatch, extension, etl_type="SelfHosted")

        assert extractor_name == expected_extractor

    def test_extract_routes_excel_with_image_writer(self, monkeypatch: pytest.MonkeyPatch) -> None:
        image_writer = _ImageWriter()
        extractor_name, args, kwargs = self._run_extract_for_extension(
            monkeypatch,
            ".xlsx",
            etl_type="SelfHosted",
            image_writer=image_writer,
        )

        assert extractor_name == "ExcelExtractor"
        assert len(args) == 1
        assert kwargs == {"image_writer": image_writer}

    def test_parser_owns_image_writes_while_processor_returns_documents(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class ImageWritingExtractor:
            def __init__(self, _file_path: str, *, image_writer: ImageWriter) -> None:
                self._image_writer = image_writer

            def extract(self) -> list[Document]:
                reference = self._image_writer.write(
                    ExtractedImage(content=b"image", extension="png", mime_type="image/png")
                )
                return [Document(page_content=reference.preview_url)]

        apply_config_overrides(monkeypatch, ETL_TYPE="SelfHosted")
        monkeypatch.setattr(processor_module, "PdfExtractor", ImageWritingExtractor)
        monkeypatch.setattr(
            processor_module.storage,
            "download",
            lambda _key, local_path: Path(local_path).write_text("content", encoding="utf-8"),
        )
        setting = ExtractSetting(
            datasource_type=DatasourceType.FILE,
            upload_file=_upload_file(key="uploaded.pdf"),
        )
        image_writer = _ImageWriter()

        result = ExtractProcessor.extract(setting, image_writer=image_writer)

        assert [document.page_content for document in result.documents] == ["/files/created-upload-1/preview"]
        assert image_writer.calls == [ExtractedImage(content=b"image", extension="png", mime_type="image/png")]
        assert result.created_upload_artifacts == ()

    @pytest.mark.parametrize("extension", [".xlsx", ".pdf", ".docx"])
    def test_extract_passes_image_writer_to_image_extractors(
        self, monkeypatch: pytest.MonkeyPatch, extension: str
    ) -> None:
        image_writer = _ImageWriter()
        _, _, kwargs = self._run_extract_for_extension(
            monkeypatch,
            extension,
            etl_type="SelfHosted",
            image_writer=image_writer,
        )

        assert kwargs["image_writer"] is image_writer

    def test_extract_does_not_pass_image_writer_to_text_extractors(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _, _, kwargs = self._run_extract_for_extension(monkeypatch, ".txt", etl_type="SelfHosted")

        assert kwargs == {"autodetect_encoding": True}

    def test_extract_requires_upload_file_when_file_path_not_provided(self) -> None:
        setting = ExtractSetting(datasource_type=DatasourceType.FILE, upload_file=None)

        with pytest.raises(AssertionError, match="upload_file is required"):
            ExtractProcessor.extract(setting)


@dataclass(frozen=True)
class _WebsiteServiceDouble:
    service: WebsiteService
    crawl: Mock
    scrape: Mock


def _website_service(
    *,
    crawl_data: Mapping[str, object] | None = None,
    scrape_data: Mapping[str, object] | None = None,
) -> _WebsiteServiceDouble:
    service = create_autospec(WebsiteService, instance=True)
    crawl = cast(Mock, service.get_crawl_url_data_by_ref)
    scrape = cast(Mock, service.get_scrape_url_data_by_ref)
    crawl.return_value = dict(crawl_data) if crawl_data is not None else None
    scrape.return_value = dict(scrape_data) if scrape_data is not None else None
    return _WebsiteServiceDouble(
        service=cast(WebsiteService, service),
        crawl=crawl,
        scrape=scrape,
    )


def _website_setting(provider: str, mode: str) -> ExtractSetting:
    return ExtractSetting(
        datasource_type=DatasourceType.WEBSITE,
        website_info=WebsiteInfo(
            job_ref=WebsiteJobRef(
                tenant_id="tenant",
                provider=provider,
                provider_instance_id="0" * 64,
                job_id="job",
            ),
            url="https://example.com",
            mode=mode,
            only_main_content=True,
        ),
    )


class TestExtractProcessorDatasourceRouting:
    def test_extract_routes_notion_datasource(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = _patch_all_extractors(monkeypatch)

        notion_info = NotionInfo(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            credential_id="cred",
            notion_access_token="secret",
        )
        setting = ExtractSetting(datasource_type=DatasourceType.NOTION, notion_info=notion_info)

        result = ExtractProcessor.extract(setting)

        assert result.documents[0].page_content == "extracted-by-NotionExtractor"
        assert result.source_version is None
        assert factory.calls[-1][0] == "NotionExtractor"
        assert factory.calls[-1][2] == {
            "notion_obj_id": "obj",
            "notion_page_type": "page",
            "notion_access_token": "secret",
        }
        assert factory.events == ["NotionExtractor.extract"]

        factory.events.clear()
        captured = ExtractProcessor.extract(setting, capture_source_version=True)
        assert captured.source_version == "2026-10-24T00:00:00Z"
        assert factory.events == ["NotionExtractor.source_version", "NotionExtractor.extract"]

    def test_extract_rejects_unresolved_notion_token(self) -> None:
        setting = ExtractSetting(
            datasource_type=DatasourceType.NOTION,
            notion_info=NotionInfo(
                notion_obj_id="obj",
                notion_page_type="page",
                tenant_id="tenant",
                credential_id="cred",
            ),
        )

        with pytest.raises(ValueError, match="must be resolved"):
            ExtractProcessor.extract(setting)

    @pytest.mark.parametrize("provider", ["firecrawl", "watercrawl"])
    @pytest.mark.parametrize("mode", ["crawl", "scrape"])
    def test_extracts_firecrawl_and_watercrawl_by_stable_job_ref(self, provider: str, mode: str) -> None:
        page = {
            "markdown": f"{provider}-{mode}",
            "source_url": "https://example.com/source",
            "description": "description",
            "title": "title",
        }
        website = _website_service(
            crawl_data=page if mode == "crawl" else None,
            scrape_data=page if mode == "scrape" else None,
        )
        setting = _website_setting(provider, mode)
        assert setting.website_info is not None

        result = ExtractProcessor.extract(setting, website_service=website.service)

        assert result.documents == [
            Document(
                page_content=f"{provider}-{mode}",
                metadata={
                    "source_url": "https://example.com/source",
                    "description": "description",
                    "title": "title",
                },
            )
        ]
        if mode == "crawl":
            website.crawl.assert_called_once_with(setting.website_info.job_ref, "https://example.com")
            website.scrape.assert_not_called()
        else:
            website.crawl.assert_not_called()
            website.scrape.assert_called_once_with(setting.website_info.job_ref, "https://example.com", True)

    @pytest.mark.parametrize("provider", ["firecrawl", "watercrawl"])
    @pytest.mark.parametrize("mode", ["crawl", "scrape"])
    def test_extract_returns_empty_when_website_service_has_no_page(self, provider: str, mode: str) -> None:
        website = _website_service()

        result = ExtractProcessor.extract(_website_setting(provider, mode), website_service=website.service)

        assert result.documents == []

    def test_extracts_jina_scrape_without_job_lookup(self) -> None:
        website = _website_service(
            crawl_data={
                "content": "jina-content",
                "url": "https://example.com/jina",
                "description": "description",
                "title": "title",
            }
        )
        setting = _website_setting("jinareader", "scrape")
        assert setting.website_info is not None

        result = ExtractProcessor.extract(setting, website_service=website.service)

        assert result.documents[0].page_content == "jina-content"
        assert result.documents[0].metadata["source_url"] == "https://example.com/jina"
        website.crawl.assert_called_once_with(
            setting.website_info.job_ref,
            "https://example.com",
            use_job=False,
        )
        website.scrape.assert_not_called()

    def test_extract_unknown_website_mode_returns_empty_without_remote_read(self) -> None:
        website = _website_service()

        result = ExtractProcessor.extract(
            _website_setting("firecrawl", "unknown"),
            website_service=website.service,
        )

        assert result.documents == []
        website.crawl.assert_not_called()
        website.scrape.assert_not_called()

    def test_extract_website_requires_explicit_service(self) -> None:
        with pytest.raises(ValueError, match="requires a website service"):
            ExtractProcessor.extract(_website_setting("firecrawl", "crawl"))

    def test_extract_unsupported_website_provider(self) -> None:
        with pytest.raises(ValueError, match="Unsupported website provider"):
            ExtractProcessor.extract(
                _website_setting("unknown", "crawl"),
                website_service=_website_service().service,
            )

    def test_extract_unsupported_datasource_type(self) -> None:
        with pytest.raises(ValueError, match="Unsupported datasource type"):
            ExtractProcessor.extract(ExtractSetting(datasource_type="unknown"))

    def test_extract_requires_notion_info(self) -> None:
        with pytest.raises(AssertionError, match="notion_info is required"):
            ExtractProcessor.extract(ExtractSetting(datasource_type=DatasourceType.NOTION, notion_info=None))

    def test_extract_requires_website_info(self) -> None:
        with pytest.raises(AssertionError, match="website_info is required"):
            ExtractProcessor.extract(
                ExtractSetting(datasource_type=DatasourceType.WEBSITE, website_info=None),
                website_service=_website_service().service,
            )
