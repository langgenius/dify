import logging
from typing import List, Optional

from langchain.document_loaders.base import BaseLoader
from langchain.schema import Document
from pypdf import PdfReader

from extensions.ext_storage import storage
from models.model import UploadFile

logger = logging.getLogger(__name__)


class PdfLoader(BaseLoader):
    """Load pdf files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
        self,
        file_path: str,
        upload_file: Optional[UploadFile] = None
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._upload_file = upload_file

    def load(self) -> List[Document]:
        plaintext_file_key = ''
        plaintext_file_exists = False
        if self._upload_file:
            if self._upload_file.hash:
                plaintext_file_key = 'upload_files/' + self._upload_file.tenant_id + '/' \
                                     + self._upload_file.hash + '.plaintext'
                try:
                    text = storage.load(plaintext_file_key).decode('utf-8')
                    plaintext_file_exists = True
                    metadata = {"source": self._file_path}
                    return [Document(page_content=text, metadata=metadata)]
                except FileNotFoundError:
                    pass

        text_list = []
        with open(self._file_path, "rb") as fp:
            # Create a PDF object
            pdf = PdfReader(fp)

            # Get the number of pages in the PDF document
            num_pages = len(pdf.pages)

            # Iterate over every page
            for page in range(num_pages):
                # Extract the text from the page
                page_text = pdf.pages[page].extract_text()
                text_list.append(page_text)
        text = "\n\n".join(text_list)

        # save plaintext file for caching
        if not plaintext_file_exists and plaintext_file_key:
            storage.save(plaintext_file_key, text.encode('utf-8'))

        metadata = {"source": self._file_path}
        return [Document(page_content=text, metadata=metadata)]

