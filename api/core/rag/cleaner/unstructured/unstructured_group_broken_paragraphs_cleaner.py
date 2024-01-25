"""Abstract interface for document clean implementations."""
from typing import List, Iterator, Optional, Dict
from app.models.document import Document
from app.services.cleaner.cleaner_base import BaseCleaner
from app.services.extractor.extractor_base import BaseExtractor
from openpyxl.reader.excel import load_workbook

from app.services.extractor.helpers import detect_file_encodings


class UnstructuredGroupBrokenParagraphsCleaner(BaseCleaner):

    def clean(self, content) -> str:
        """clean document content."""
        import re
        from unstructured.cleaners.core import group_broken_paragraphs

        para_split_re = re.compile(r"(\s*\n\s*){3}")

        return group_broken_paragraphs(content, paragraph_split=para_split_re)
