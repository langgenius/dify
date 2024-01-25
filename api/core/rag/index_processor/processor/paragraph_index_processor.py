"""Paragraph index processor."""
from typing import List

from core.rag.cleaner.cleaner_base import BaseCleaner
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import Document


class ParagraphIndexProcessor(BaseIndexProcessor):

    def __init__(self, extractor: BaseExtractor, cleaner: BaseCleaner):
        super().__init__(extractor, cleaner)

    def format(self, documents: List[Document]):
        return documents

    def load(self, source):
        pass

    def retrieve(self):
        pass
