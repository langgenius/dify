"""Abstract interface for document clean implementations."""
from typing import List, Iterator, Optional, Dict
from app.models.document import Document
from app.services.cleaner.cleaner_base import BaseCleaner
from app.services.extractor.extractor_base import BaseExtractor
from openpyxl.reader.excel import load_workbook

from app.services.extractor.helpers import detect_file_encodings


class UnstructuredNonAsciiCharsCleaner(BaseCleaner):

    def clean(self, content) -> str:
        """Replaces unicode quote characters, such as the \x91 character in a string."""

        from unstructured.cleaners.core import replace_unicode_quotes
        return replace_unicode_quotes(content)
