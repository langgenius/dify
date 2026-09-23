import pytest

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor
from services.file_upload_service import FileUploadService


class TestIndexProcessorFactory:
    def test_requires_index_type(self, file_uploads: FileUploadService) -> None:
        factory = IndexProcessorFactory(file_uploads=file_uploads)

        with pytest.raises(ValueError, match="Index type must be specified"):
            factory.create(None)

    def test_builds_paragraph_processor(self, file_uploads: FileUploadService) -> None:
        factory = IndexProcessorFactory(file_uploads=file_uploads)

        processor = factory.create(IndexStructureType.PARAGRAPH_INDEX)

        assert isinstance(processor, ParagraphIndexProcessor)
        assert processor._file_uploads is file_uploads

    def test_builds_qa_processor(self, file_uploads: FileUploadService) -> None:
        factory = IndexProcessorFactory(file_uploads=file_uploads)

        processor = factory.create(IndexStructureType.QA_INDEX)

        assert isinstance(processor, QAIndexProcessor)
        assert processor._file_uploads is file_uploads

    def test_builds_parent_child_processor(self, file_uploads: FileUploadService) -> None:
        factory = IndexProcessorFactory(file_uploads=file_uploads)

        processor = factory.create(IndexStructureType.PARENT_CHILD_INDEX)

        assert isinstance(processor, ParentChildIndexProcessor)
        assert processor._file_uploads is file_uploads

    def test_rejects_unsupported_index_type(self, file_uploads: FileUploadService) -> None:
        factory = IndexProcessorFactory(file_uploads=file_uploads)

        with pytest.raises(ValueError, match="is not supported"):
            factory.create("unsupported")

    def test_shared_factory_selects_each_type_and_creates_fresh_processors(
        self, file_uploads: FileUploadService
    ) -> None:
        factory = IndexProcessorFactory(file_uploads=file_uploads)
        selections = [
            (IndexStructureType.PARAGRAPH_INDEX, ParagraphIndexProcessor),
            (IndexStructureType.QA_INDEX, QAIndexProcessor),
            (IndexStructureType.PARENT_CHILD_INDEX, ParentChildIndexProcessor),
        ]
        processors = []

        for index_type, processor_type in selections * 2:
            processor = factory.create(index_type)
            assert isinstance(processor, processor_type)
            assert processor._file_uploads is file_uploads
            assert all(processor is not previous for previous in processors)
            processors.append(processor)
