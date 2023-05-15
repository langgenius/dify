from pathlib import Path
from typing import Dict

from flask import current_app
from llama_index.readers.file.base_parser import BaseParser
from pypdf import PdfReader

from extensions.ext_storage import storage
from models.model import UploadFile


class PDFParser(BaseParser):
    """PDF parser."""

    def _init_parser(self) -> Dict:
        """Init parser."""
        return {}

    def parse_file(self, file: Path, errors: str = "ignore") -> str:
        """Parse file."""
        if not current_app.config.get('PDF_PREVIEW', True):
            return ''

        plaintext_file_key = ''
        plaintext_file_exists = False
        if self._parser_config and 'upload_file' in self._parser_config and self._parser_config['upload_file']:
            upload_file: UploadFile = self._parser_config['upload_file']
            if upload_file.hash:
                plaintext_file_key = 'upload_files/' + upload_file.tenant_id + '/' + upload_file.hash + '.plaintext'
                try:
                    text = storage.load(plaintext_file_key).decode('utf-8')
                    plaintext_file_exists = True
                    return text
                except FileNotFoundError:
                    pass

        text_list = []
        with open(file, "rb") as fp:
            # Create a PDF object
            pdf = PdfReader(fp)

            # Get the number of pages in the PDF document
            num_pages = len(pdf.pages)

            # Iterate over every page
            for page in range(num_pages):
                # Extract the text from the page
                page_text = pdf.pages[page].extract_text()
                text_list.append(page_text)
        text = "\n".join(text_list)

        # save plaintext file for caching
        if not plaintext_file_exists and plaintext_file_key:
            storage.save(plaintext_file_key, text.encode('utf-8'))

        return text
