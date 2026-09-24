"""Create document processors with application-scoped dependencies."""

from core.file.uploads import FileUploadWriter
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor


class IndexProcessorFactory:
    """Bind upload dependencies once and choose a fresh processor for each call."""

    def __init__(self, *, file_uploads: FileUploadWriter) -> None:
        self._file_uploads = file_uploads

    def create(self, index_type: str | None) -> BaseIndexProcessor:
        """Create the requested processor; None means the index type is missing."""

        if not index_type:
            raise ValueError("Index type must be specified.")

        if index_type == IndexStructureType.PARAGRAPH_INDEX:
            return ParagraphIndexProcessor(file_uploads=self._file_uploads)
        elif index_type == IndexStructureType.QA_INDEX:
            return QAIndexProcessor(file_uploads=self._file_uploads)
        elif index_type == IndexStructureType.PARENT_CHILD_INDEX:
            return ParentChildIndexProcessor(file_uploads=self._file_uploads)
        else:
            raise ValueError(f"Index type {index_type} is not supported.")
