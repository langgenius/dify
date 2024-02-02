"""Abstract interface for document loader implementations."""

from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor
from models.dataset import DatasetProcessRule


class IndexProcessorFactory:
    """IndexProcessorInit.
    """

    def __init__(self, index_type: str, process_rule: dict):
        self._process_rule = process_rule
        self._index_type = index_type

    def init_index_processor(self) -> BaseIndexProcessor:
        """Init index processor."""

        if not self._index_type:
            raise ValueError(f"Index type must be specified.")

        if self._index_type == IndexType.PARAGRAPH_INDEX.value:
            return ParagraphIndexProcessor(
                process_rule=self._process_rule
            )
        elif self._index_type == IndexType.QA_INDEX.value:

            return QAIndexProcessor(
                process_rule=self._process_rule
            )
        else:
            raise ValueError(f"Index type {self._index_type} is not supported.")
