import tempfile
from pathlib import Path
from typing import List, Union

from langchain.document_loaders import TextLoader, Docx2txtLoader
from langchain.schema import Document

from core.data_loader.loader.csv import CSVLoader
from core.data_loader.loader.excel import ExcelLoader
from core.data_loader.loader.html import HTMLLoader
from core.data_loader.loader.markdown import MarkdownLoader
from core.data_loader.loader.pdf import PdfLoader
from extensions.ext_storage import storage
from models.model import UploadFile


class FileExtractor:
    @classmethod
    def load(cls, upload_file: UploadFile, return_text: bool = False) -> Union[List[Document] | str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(upload_file.key).suffix
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
            storage.download(upload_file.key, file_path)

            input_file = Path(file_path)
            delimiter = '\n'
            if input_file.suffix == '.xlsx':
                loader = ExcelLoader(file_path)
            elif input_file.suffix == '.pdf':
                loader = PdfLoader(file_path, upload_file=upload_file)
            elif input_file.suffix in ['.md', '.markdown']:
                loader = MarkdownLoader(file_path, autodetect_encoding=True)
            elif input_file.suffix in ['.htm', '.html']:
                loader = HTMLLoader(file_path)
            elif input_file.suffix == '.docx':
                loader = Docx2txtLoader(file_path)
            elif input_file.suffix == '.csv':
                loader = CSVLoader(file_path, autodetect_encoding=True)
            else:
                # txt
                loader = TextLoader(file_path, autodetect_encoding=True)

            return delimiter.join([document.page_content for document in loader.load()]) if return_text else loader.load()
