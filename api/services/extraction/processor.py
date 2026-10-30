import re
import tempfile
from pathlib import Path
from typing import Literal, overload
from urllib.parse import unquote

from configs import dify_config
from core.file import remote_fetcher
from core.rag.extractor.csv_extractor import CSVExtractor
from core.rag.extractor.excel_extractor import ExcelExtractor
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.html_extractor import HtmlExtractor
from core.rag.extractor.markdown_extractor import MarkdownExtractor
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.extractor.pdf_extractor import PdfExtractor
from core.rag.extractor.text_extractor import TextExtractor
from core.rag.extractor.unstructured.unstructured_doc_extractor import UnstructuredWordExtractor
from core.rag.extractor.unstructured.unstructured_eml_extractor import UnstructuredEmailExtractor
from core.rag.extractor.unstructured.unstructured_epub_extractor import UnstructuredEpubExtractor
from core.rag.extractor.unstructured.unstructured_markdown_extractor import UnstructuredMarkdownExtractor
from core.rag.extractor.unstructured.unstructured_msg_extractor import UnstructuredMsgExtractor
from core.rag.extractor.unstructured.unstructured_ppt_extractor import UnstructuredPPTExtractor
from core.rag.extractor.unstructured.unstructured_pptx_extractor import UnstructuredPPTXExtractor
from core.rag.extractor.unstructured.unstructured_xml_extractor import UnstructuredXmlExtractor
from core.rag.extractor.word_extractor import WordExtractor
from core.rag.models.document import Document
from extensions.ext_storage import storage
from services.data_source.website_service import WebsiteService
from services.extraction.contracts import DatasourceType, ExtractionResult, ExtractSetting, ImageWriter

SUPPORT_URL_CONTENT_TYPES = ["application/pdf", "text/plain", "application/json"]
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124"
    " Safari/537.36"
)


class ExtractProcessor:
    @overload
    @classmethod
    def load_from_url(cls, url: str, return_text: Literal[True]) -> str: ...

    @overload
    @classmethod
    def load_from_url(cls, url: str, return_text: Literal[False] = False) -> list[Document]: ...

    @classmethod
    def load_from_url(cls, url: str, return_text: bool = False) -> list[Document] | str:
        response = remote_fetcher.make_request("GET", url, headers={"User-Agent": USER_AGENT})

        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(url).suffix
            if not suffix and suffix != ".":
                # get content-type
                content_type = response.headers.get("Content-Type")
                if content_type:
                    # strip parameters such as "; charset=utf-8" before using the subtype as suffix
                    suffix = "." + content_type.split(";")[0].strip().split("/")[-1]
                else:
                    content_disposition = response.headers.get("Content-Disposition", "")
                    filename_match = re.search(r'filename="([^"]+)"', content_disposition)
                    if filename_match:
                        filename = unquote(filename_match.group(1))
                        match = re.search(r"\.(\w+)$", filename)
                        suffix = "." + match.group(1) if match else ""
            # https://stackoverflow.com/questions/26541416/generate-temporary-file-names-without-creating-actual-file-in-python#comment90414256_26541521
            # Generate a temporary filename under the created temp_dir and ensure the directory exists
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"  # type: ignore
            Path(file_path).write_bytes(response.content)
            extract_setting = ExtractSetting(datasource_type=DatasourceType.FILE, document_model="text_model")
            if return_text:
                delimiter = "\n"
                result = cls.extract(extract_setting=extract_setting, file_path=file_path)
                return delimiter.join(document.page_content for document in result.documents)
            else:
                return cls.extract(extract_setting=extract_setting, file_path=file_path).documents

    @classmethod
    def extract(
        cls,
        extract_setting: ExtractSetting,
        is_automatic: bool = False,
        file_path: str | None = None,
        *,
        image_writer: ImageWriter | None = None,
        website_service: WebsiteService | None = None,
        capture_source_version: bool = False,
    ) -> ExtractionResult[Document]:
        if extract_setting.datasource_type == DatasourceType.FILE:
            upload_file = extract_setting.upload_file
            with tempfile.TemporaryDirectory() as temp_dir:
                upload_file = extract_setting.upload_file
                if not file_path:
                    assert upload_file is not None, "upload_file is required"
                    suffix = Path(upload_file.key).suffix
                    # FIXME mypy: Cannot determine type of 'tempfile._get_candidate_names' better not use it here
                    file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"  # type: ignore
                    storage.download(upload_file.key, file_path)
                input_file = Path(file_path)
                file_extension = input_file.suffix.lower()
                etl_type = dify_config.ETL_TYPE
                extractor: BaseExtractor | None = None
                if etl_type == "Unstructured":
                    unstructured_api_url = dify_config.UNSTRUCTURED_API_URL or ""
                    unstructured_api_key = dify_config.UNSTRUCTURED_API_KEY or ""

                    if file_extension in {".xlsx", ".xls"}:
                        assert upload_file is not None, "upload_file is required"
                        extractor = ExcelExtractor(
                            file_path,
                            image_writer=image_writer,
                        )
                    elif file_extension == ".pdf":
                        extractor = PdfExtractor(
                            file_path,
                            image_writer=image_writer,
                        )
                    elif file_extension in {".md", ".markdown", ".mdx"}:
                        extractor = (
                            UnstructuredMarkdownExtractor(file_path, unstructured_api_url, unstructured_api_key)
                            if is_automatic
                            else MarkdownExtractor(file_path, autodetect_encoding=True)
                        )
                    elif file_extension in {".htm", ".html"}:
                        extractor = HtmlExtractor(file_path)
                    elif file_extension == ".docx":
                        assert upload_file is not None
                        extractor = WordExtractor(
                            file_path,
                            image_writer=image_writer,
                        )
                    elif file_extension == ".doc":
                        extractor = UnstructuredWordExtractor(file_path, unstructured_api_url, unstructured_api_key)
                    elif file_extension == ".csv":
                        extractor = CSVExtractor(file_path, autodetect_encoding=True)
                    elif file_extension == ".msg":
                        extractor = UnstructuredMsgExtractor(file_path, unstructured_api_url, unstructured_api_key)
                    elif file_extension == ".eml":
                        extractor = UnstructuredEmailExtractor(file_path, unstructured_api_url, unstructured_api_key)
                    elif file_extension == ".ppt":
                        extractor = UnstructuredPPTExtractor(file_path, unstructured_api_url, unstructured_api_key)
                        # You must first specify the API key
                        # because unstructured_api_key is necessary to parse .ppt documents
                    elif file_extension == ".pptx":
                        extractor = UnstructuredPPTXExtractor(file_path, unstructured_api_url, unstructured_api_key)
                    elif file_extension == ".xml":
                        extractor = UnstructuredXmlExtractor(file_path, unstructured_api_url, unstructured_api_key)
                    elif file_extension == ".epub":
                        extractor = UnstructuredEpubExtractor(file_path, unstructured_api_url, unstructured_api_key)
                    else:
                        # txt
                        extractor = TextExtractor(file_path, autodetect_encoding=True)
                else:
                    if file_extension in {".xlsx", ".xls"}:
                        assert upload_file is not None, "upload_file is required"
                        extractor = ExcelExtractor(
                            file_path,
                            image_writer=image_writer,
                        )
                    elif file_extension == ".pdf":
                        extractor = PdfExtractor(
                            file_path,
                            image_writer=image_writer,
                        )
                    elif file_extension in {".md", ".markdown", ".mdx"}:
                        extractor = MarkdownExtractor(file_path, autodetect_encoding=True)
                    elif file_extension in {".htm", ".html"}:
                        extractor = HtmlExtractor(file_path)
                    elif file_extension == ".docx":
                        assert upload_file is not None
                        extractor = WordExtractor(
                            file_path,
                            image_writer=image_writer,
                        )
                    elif file_extension == ".csv":
                        extractor = CSVExtractor(file_path, autodetect_encoding=True)
                    elif file_extension == ".epub":
                        extractor = UnstructuredEpubExtractor(file_path)
                    else:
                        # txt
                        extractor = TextExtractor(file_path, autodetect_encoding=True)
                documents = extractor.extract()
                return ExtractionResult(documents=documents)
        elif extract_setting.datasource_type == DatasourceType.NOTION:
            assert extract_setting.notion_info is not None, "notion_info is required"
            notion_info = extract_setting.notion_info
            if not notion_info.notion_access_token:
                raise ValueError("Notion access token must be resolved before extraction")
            extractor = NotionExtractor(
                notion_obj_id=notion_info.notion_obj_id,
                notion_page_type=notion_info.notion_page_type,
                notion_access_token=notion_info.notion_access_token,
            )
            source_version = extractor.get_notion_last_edited_time() if capture_source_version else None
            documents = extractor.extract()
            return ExtractionResult(documents=documents, source_version=source_version)
        elif extract_setting.datasource_type == DatasourceType.WEBSITE:
            assert extract_setting.website_info is not None, "website_info is required"
            info = extract_setting.website_info
            if info.job_ref.provider not in {"firecrawl", "watercrawl", "jinareader"}:
                raise ValueError(f"Unsupported website provider: {info.job_ref.provider}")
            if info.mode not in {"crawl", "scrape"}:
                return ExtractionResult(documents=[])
            if website_service is None:
                raise ValueError("Website extraction requires a website service")
            if info.job_ref.provider == "jinareader":
                data = website_service.get_crawl_url_data_by_ref(info.job_ref, info.url, use_job=info.mode == "crawl")
                content_key, source_key = "content", "url"
            elif info.mode == "crawl":
                data = website_service.get_crawl_url_data_by_ref(info.job_ref, info.url)
                content_key, source_key = "markdown", "source_url"
            else:
                data = website_service.get_scrape_url_data_by_ref(info.job_ref, info.url, info.only_main_content)
                content_key, source_key = "markdown", "source_url"
            if data is None:
                return ExtractionResult(documents=[])
            return ExtractionResult(
                documents=[
                    Document(
                        page_content=data.get(content_key, ""),
                        metadata={
                            "source_url": data.get(source_key),
                            "description": data.get("description"),
                            "title": data.get("title"),
                        },
                    )
                ],
            )
        else:
            raise ValueError(f"Unsupported datasource type: {extract_setting.datasource_type}")
