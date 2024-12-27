"""Abstract interface for document loader implementations."""

from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor


class IndexProcessorFactory:
    """IndexProcessorInit."""

    def __init__(self, index_type: str | None):
        self._index_type = index_type

    def init_index_processor(self) -> BaseIndexProcessor:
        """Init index processor."""

        if not self._index_type:
            raise ValueError("Index type must be specified.")

        if self._index_type == IndexType.PARAGRAPH_INDEX:
            return ParagraphIndexProcessor()
        elif self._index_type == IndexType.QA_INDEX:
            return QAIndexProcessor()
        elif self._index_type == IndexType.PARENT_CHILD_INDEX:
            return ParentChildIndexProcessor()
        else:
            raise ValueError(f"Index type {self._index_type} is not supported.")
