"""Exercise the legacy Pipeline parent-child entry point against real keyword rows."""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.keyword.jieba import jieba as jieba_module
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from models.dataset import ChildChunk, Dataset, DocumentSegment
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_dataset, make_document


@pytest.mark.parametrize("technique", [IndexTechniqueType.ECONOMY, IndexTechniqueType.HIGH_QUALITY])
def test_pipeline_reindex_replaces_child_keywords_and_rows(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    technique: IndexTechniqueType,
) -> None:
    apply_config_overrides(monkeypatch, KEYWORD_STORE="jieba", KEYWORD_DATA_SOURCE_TYPE="database")

    class KeywordExtractor:
        def extract_keywords(self, text: str, _keyword_number: int = 10) -> set[str]:
            return set(text.split())

    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", KeywordExtractor)
    dataset = make_dataset(indexing_technique=technique, chunk_structure=IndexStructureType.PARENT_CHILD_INDEX)
    document = make_document(
        doc_form=IndexStructureType.PARENT_CHILD_INDEX, dataset_id=dataset.id, tenant_id=dataset.tenant_id
    )
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    def hits(term: str) -> list[str]:
        with sqlite_session_factory() as reader:
            current_dataset = reader.get(Dataset, dataset.id)
            assert current_dataset is not None
            return [item.page_content for item in Jieba(current_dataset).search(term, session=reader)]

    processor = IndexProcessor()
    with (
        patch("core.rag.index_processor.index_processor.VectorSpaceAdmissionService") as admission,
        patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as vector,
        patch(
            "core.rag.index_processor.processor.parent_child_index_processor.AccountService.load_user",
            return_value=MagicMock(),
        ),
        patch.object(ParentChildIndexProcessor, "_get_content_files", return_value=[]),
        patch(
            "core.rag.index_processor.processor.parent_child_index_processor.calculate_segment_token_counts",
            side_effect=lambda **kwargs: [1] * len(kwargs["documents"]),
        ),
        patch(
            "core.rag.index_processor.processor.parent_child_index_processor.session_factory.create_session",
            side_effect=sqlite_session_factory,
        ),
    ):
        for prior_document_id, word in (("", "oldword"), (document.id, "newword")):
            result = processor.index_and_clean(
                dataset.id,
                document.id,
                prior_document_id,
                {"parent_child_chunks": [{"parent_content": "parent", "child_contents": [word]}]},
                "batch",
                session=sqlite_session,
            )
            sqlite_session.commit()
            assert result["display_status"] == "completed"
            assert hits(word) == [word]
        admission.return_value.ensure_pipeline_can_be_indexed.assert_called_once()
        if technique == IndexTechniqueType.ECONOMY:
            vector.assert_not_called()
        else:
            assert vector.return_value.create.call_count == 2

    assert hits("oldword") == []
    with sqlite_session_factory() as reader:
        children = reader.scalars(select(ChildChunk).where(ChildChunk.dataset_id == dataset.id)).all()
        parents = reader.scalars(select(DocumentSegment).where(DocumentSegment.dataset_id == dataset.id)).all()
        assert len(children) == len(parents) == 1
        assert children[0].content == "newword"
        assert children[0].segment_id == parents[0].id
