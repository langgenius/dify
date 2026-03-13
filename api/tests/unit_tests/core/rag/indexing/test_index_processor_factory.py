import pytest

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor


class TestIndexProcessorFactory:
    def test_requires_index_type(self) -> None:
        factory = IndexProcessorFactory(index_type=None)

        with pytest.raises(ValueError, match="Index type must be specified"):
            factory.init_index_processor()

    def test_builds_paragraph_processor(self) -> None:
        factory = IndexProcessorFactory(index_type=IndexStructureType.PARAGRAPH_INDEX)

        processor = factory.init_index_processor()

        assert isinstance(processor, ParagraphIndexProcessor)

    def test_builds_qa_processor(self) -> None:
        factory = IndexProcessorFactory(index_type=IndexStructureType.QA_INDEX)

        processor = factory.init_index_processor()

        assert isinstance(processor, QAIndexProcessor)

    def test_builds_parent_child_processor(self) -> None:
        factory = IndexProcessorFactory(index_type=IndexStructureType.PARENT_CHILD_INDEX)

        processor = factory.init_index_processor()

        assert isinstance(processor, ParentChildIndexProcessor)

    def test_rejects_unsupported_index_type(self) -> None:
        factory = IndexProcessorFactory(index_type="unsupported")

        with pytest.raises(ValueError, match="is not supported"):
            factory.init_index_processor()
