import tempfile
from pathlib import Path
from typing import List, Optional, Union

import requests
from core.data_loader.loader.word import DocExtractor
from core.rag.extractor.csv_extractor import CSVExtractor
from core.rag.extractor.excel_extractor import ExcelExtractor
from core.rag.extractor.html_extractor import HtmlExtractor
from core.rag.extractor.markdown_extractor import MarkdownExtractor
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
from core.rag.models.document import Document
from extensions.ext_storage import storage
from flask import current_app
from models.model import UploadFile

SUPPORT_URL_CONTENT_TYPES = ['application/pdf', 'text/plain']
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"


class ExtractProcessor:
    @classmethod
    def load(cls, upload_file: UploadFile, return_text: bool = False, is_automatic: bool = False) -> Union[List[Document], str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(upload_file.key).suffix
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
            storage.download(upload_file.key, file_path)

            return cls.load_from_file(file_path, return_text, upload_file, is_automatic)

    @classmethod
    def load_from_url(cls, url: str, return_text: bool = False) -> Union[List[Document], str]:
        response = requests.get(url, headers={
            "User-Agent": USER_AGENT
        })

        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(url).suffix
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
            with open(file_path, 'wb') as file:
                file.write(response.content)

            return cls.load_from_file(file_path, return_text)

    @classmethod
    def load_from_file(cls, file_path: str, is_automatic: bool = False) -> List[Document]:
        input_file = Path(file_path)
        delimiter = '\n'
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
            elif file_extension in ['.docx', '.doc']:
                extractor = UnstructuredWordExtractor(file_path)
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
            elif file_extension in ['.docx', '.doc']:
                extractor = DocExtractor(file_path)
            elif file_extension == '.csv':
                extractor = CSVExtractor(file_path, autodetect_encoding=True)
            else:
                # txt
                extractor = TextExtractor(file_path, autodetect_encoding=True)

        return extractor.extract()
