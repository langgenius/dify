"""Abstract interface for document loader implementations."""

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor
from services.file_upload_service import FileUploadWriter


class IndexProcessorFactory:
    """IndexProcessorInit."""

    def __init__(self, index_type: str | None, *, file_uploads: FileUploadWriter) -> None:
        self._index_type = index_type
        self._file_uploads = file_uploads

    def init_index_processor(self) -> BaseIndexProcessor:
        """Init index processor."""

        if not self._index_type:
            raise ValueError("Index type must be specified.")

        if self._index_type == IndexStructureType.PARAGRAPH_INDEX:
            return ParagraphIndexProcessor(file_uploads=self._file_uploads)
        elif self._index_type == IndexStructureType.QA_INDEX:
            return QAIndexProcessor(file_uploads=self._file_uploads)
        elif self._index_type == IndexStructureType.PARENT_CHILD_INDEX:
            return ParentChildIndexProcessor(file_uploads=self._file_uploads)
        else:
            raise ValueError(f"Index type {self._index_type} is not supported.")
