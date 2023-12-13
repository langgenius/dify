import tempfile
from pathlib import Path
from typing import List, Union, Optional

import requests
from langchain.document_loaders import TextLoader, Docx2txtLoader, UnstructuredFileLoader, UnstructuredAPIFileLoader
from langchain.schema import Document

from core.data_loader.loader.csv_loader import CSVLoader
from core.data_loader.loader.excel import ExcelLoader
from core.data_loader.loader.html import HTMLLoader
from core.data_loader.loader.markdown import MarkdownLoader
from core.data_loader.loader.pdf import PdfLoader
from extensions.ext_storage import storage
from models.model import UploadFile

SUPPORT_URL_CONTENT_TYPES = ['application/pdf', 'text/plain']
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"


class FileExtractor:
    @classmethod
    def load(cls, upload_file: UploadFile, return_text: bool = False, is_automatic: bool = False) -> Union[List[Document] | str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(upload_file.key).suffix
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
            storage.download(upload_file.key, file_path)

            return cls.load_from_file(file_path, return_text, upload_file, is_automatic)

    @classmethod
    def load_from_url(cls, url: str, return_text: bool = False) -> Union[List[Document] | str]:
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
    def load_from_file(cls, file_path: str, return_text: bool = False,
                       upload_file: Optional[UploadFile] = None,
                       is_automatic: bool = False) -> Union[List[Document] | str]:
        input_file = Path(file_path)
        delimiter = '\n'
        file_extension = input_file.suffix.lower()
        if is_automatic:
            loader = UnstructuredFileLoader(
                file_path, strategy="hi_res", mode="elements"
            )
            # loader = UnstructuredAPIFileLoader(
            #     file_path=filenames[0],
            #     api_key="FAKE_API_KEY",
            # )
        else:
            if file_extension == '.xlsx':
                loader = ExcelLoader(file_path)
            elif file_extension == '.pdf':
                loader = PdfLoader(file_path, upload_file=upload_file)
            elif file_extension in ['.md', '.markdown']:
                loader = MarkdownLoader(file_path, autodetect_encoding=True)
            elif file_extension in ['.htm', '.html']:
                loader = HTMLLoader(file_path)
            elif file_extension == '.docx':
                loader = Docx2txtLoader(file_path)
            elif file_extension == '.csv':
                loader = CSVLoader(file_path, autodetect_encoding=True)
            else:
                # txt
                loader = TextLoader(file_path, autodetect_encoding=True)

        return delimiter.join([document.page_content for document in loader.load()]) if return_text else loader.load()
