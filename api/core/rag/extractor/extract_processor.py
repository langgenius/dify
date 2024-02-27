import tempfile
from pathlib import Path
from typing import Union

import requests
from flask import current_app

from core.rag.extractor.csv_extractor import CSVExtractor
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.excel_extractor import ExcelExtractor
from core.rag.extractor.html_extractor import HtmlExtractor
from core.rag.extractor.markdown_extractor import MarkdownExtractor
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.extractor.pdf_extractor import PdfExtractor
from core.rag.extractor.text_extractor import TextExtractor
from core.rag.extractor.unstructured.unstructured_doc_extractor import UnstructuredWordExtractor
from core.rag.extractor.unstructured.unstructured_eml_extractor import UnstructuredEmailExtractor
from core.rag.extractor.unstructured.unstructured_markdown_extractor import UnstructuredMarkdownExtractor
from core.rag.extractor.unstructured.unstructured_msg_extractor import UnstructuredMsgExtractor
from core.rag.extractor.unstructured.unstructured_ppt_extractor import UnstructuredPPTExtractor
from core.rag.extractor.unstructured.unstructured_pptx_extractor import UnstructuredPPTXExtractor
from core.rag.extractor.unstructured.unstructured_text_extractor import UnstructuredTextExtractor
from core.rag.extractor.unstructured.unstructured_xml_extractor import UnstructuredXmlExtractor
from core.rag.extractor.word_extractor import WordExtractor
from core.rag.models.document import Document
from extensions.ext_storage import storage
from models.model import UploadFile

SUPPORT_URL_CONTENT_TYPES = ['application/pdf', 'text/plain']
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"


class ExtractProcessor:
    @classmethod
    def load_from_upload_file(cls, upload_file: UploadFile, return_text: bool = False, is_automatic: bool = False) \
            -> Union[list[Document], str]:
        extract_setting = ExtractSetting(
            datasource_type="upload_file",
            upload_file=upload_file,
            document_model='text_model'
        )
        if return_text:
            delimiter = '\n'
            return delimiter.join([document.page_content for document in cls.extract(extract_setting, is_automatic)])
        else:
            return cls.extract(extract_setting, is_automatic)

    @classmethod
    def load_from_url(cls, url: str, return_text: bool = False) -> Union[list[Document], str]:
        response = requests.get(url, headers={
            "User-Agent": USER_AGENT
        })

        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(url).suffix
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
            with open(file_path, 'wb') as file:
                file.write(response.content)
            extract_setting = ExtractSetting(
                datasource_type="upload_file",
                document_model='text_model'
            )
            if return_text:
                delimiter = '\n'
                return delimiter.join([document.page_content for document in cls.extract(
                    extract_setting=extract_setting, file_path=file_path)])
            else:
                return cls.extract(extract_setting=extract_setting, file_path=file_path)

    @classmethod
    def extract(cls, extract_setting: ExtractSetting, is_automatic: bool = False,
                file_path: str = None) -> list[Document]:
        if extract_setting.datasource_type == DatasourceType.FILE.value:
            with tempfile.TemporaryDirectory() as temp_dir:
                if not file_path:
                    upload_file: UploadFile = extract_setting.upload_file
                    suffix = Path(upload_file.key).suffix
                    file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
                    storage.download(upload_file.key, file_path)
                input_file = Path(file_path)
                file_extension = input_file.suffix.lower()
                etl_type = current_app.config['ETL_TYPE']
                unstructured_api_url = current_app.config['UNSTRUCTURED_API_URL']
                if etl_type == 'Unstructured':
                    if file_extension == '.xlsx':
                        extractor = ExcelExtractor(file_path)
                    elif file_extension == '.pdf':
                        extractor = PdfExtractor(file_path)
                    elif file_extension in ['.md', '.markdown']:
                        extractor = UnstructuredMarkdownExtractor(file_path, unstructured_api_url) if is_automatic \
                            else MarkdownExtractor(file_path, autodetect_encoding=True)
                    elif file_extension in ['.htm', '.html']:
                        extractor = HtmlExtractor(file_path)
                    elif file_extension in ['.docx']:
                        extractor = UnstructuredWordExtractor(file_path, unstructured_api_url)
                    elif file_extension == '.csv':
                        extractor = CSVExtractor(file_path, autodetect_encoding=True)
                    elif file_extension == '.msg':
                        extractor = UnstructuredMsgExtractor(file_path, unstructured_api_url)
                    elif file_extension == '.eml':
                        extractor = UnstructuredEmailExtractor(file_path, unstructured_api_url)
                    elif file_extension == '.ppt':
                        extractor = UnstructuredPPTExtractor(file_path, unstructured_api_url)
                    elif file_extension == '.pptx':
                        extractor = UnstructuredPPTXExtractor(file_path, unstructured_api_url)
                    elif file_extension == '.xml':
                        extractor = UnstructuredXmlExtractor(file_path, unstructured_api_url)
                    else:
                        # txt
                        extractor = UnstructuredTextExtractor(file_path, unstructured_api_url) if is_automatic \
                            else TextExtractor(file_path, autodetect_encoding=True)
                else:
                    if file_extension == '.xlsx':
                        extractor = ExcelExtractor(file_path)
                    elif file_extension == '.pdf':
                        extractor = PdfExtractor(file_path)
                    elif file_extension in ['.md', '.markdown']:
                        extractor = MarkdownExtractor(file_path, autodetect_encoding=True)
                    elif file_extension in ['.htm', '.html']:
                        extractor = HtmlExtractor(file_path)
                    elif file_extension in ['.docx']:
                        extractor = WordExtractor(file_path)
                    elif file_extension == '.csv':
                        extractor = CSVExtractor(file_path, autodetect_encoding=True)
                    else:
                        # txt
                        extractor = TextExtractor(file_path, autodetect_encoding=True)
                return extractor.extract()
        elif extract_setting.datasource_type == DatasourceType.NOTION.value:
            extractor = NotionExtractor(
                notion_workspace_id=extract_setting.notion_info.notion_workspace_id,
                notion_obj_id=extract_setting.notion_info.notion_obj_id,
                notion_page_type=extract_setting.notion_info.notion_page_type,
                document_model=extract_setting.notion_info.document,
                tenant_id=extract_setting.notion_info.tenant_id,
            )
            return extractor.extract()
        else:
            raise ValueError(f"Unsupported datasource type: {extract_setting.datasource_type}")
