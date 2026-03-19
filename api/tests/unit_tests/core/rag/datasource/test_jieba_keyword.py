from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.models.document import Document
from models.dataset import DatasetKeywordTable


class NormalizedKeywordTableState:
    storage_version = DatasetKeywordTable.STORAGE_VERSION_NORMALIZED

    @property
    def keyword_table_dict(self):
        raise AssertionError("normalized datasets should not read legacy blobs")


class LegacyKeywordTableState:
    def __init__(self):
        self.storage_version = DatasetKeywordTable.STORAGE_VERSION_LEGACY
        self.migrated_at = None

    @property
    def keyword_table_dict(self):
        return {
            "__data__": {
                "table": {
                    "alpha": ["node-1"],
                    "beta": ["node-1", "node-2"],
                }
            }
        }


class TestJieba:
    def test_text_exists_queries_segment_table_directly(self):
        dataset = Mock()
        dataset.id = "dataset-123"

        keyword = Jieba(dataset)

        with patch(
            "core.rag.datasource.keyword.jieba.jieba.db.session.scalar",
            return_value="segment-1",
        ) as mock_scalar:
            assert keyword.text_exists("node-1") is True

        mock_scalar.assert_called_once()

    def test_add_texts_collects_segment_keywords_and_replaces_entries(self):
        dataset = Mock()
        dataset.id = "dataset-123"
        dataset.keyword_number = 10

        documents = [
            Document(page_content="chunk one", metadata={"doc_id": "node-1"}),
            Document(page_content="chunk two", metadata={"doc_id": "node-2"}),
        ]

        keyword = Jieba(dataset)
        mock_handler = Mock()
        mock_handler.extract_keywords.side_effect = [["alpha", "beta"], ["gamma"]]

        with (
            patch("core.rag.datasource.keyword.jieba.jieba.redis_client.lock", return_value=nullcontext()),
            patch("core.rag.datasource.keyword.jieba.jieba.JiebaKeywordTableHandler", return_value=mock_handler),
            patch.object(keyword, "_ensure_keyword_index_migrated") as mock_ensure,
            patch.object(keyword, "_replace_segment_keywords") as mock_replace,
        ):
            keyword.add_texts(documents)

        mock_ensure.assert_called_once_with(assume_locked=True)
        mock_replace.assert_called_once_with(
            dataset.id,
            {
                "node-1": ["alpha", "beta"],
                "node-2": ["gamma"],
            },
        )

    def test_search_reads_normalized_entries_without_loading_legacy_blob(self):
        dataset = Mock()
        dataset.id = "dataset-123"
        dataset.dataset_keyword_table = NormalizedKeywordTableState()

        keyword = Jieba(dataset)
        mock_handler = Mock()
        mock_handler.extract_keywords.return_value = ["alpha", "beta"]
        mock_segment_result = Mock()
        mock_segment_result.scalars.return_value.all.return_value = [
            SimpleNamespace(
                index_node_id="node-2",
                content="second",
                index_node_hash="hash-2",
                document_id="doc-2",
                dataset_id=dataset.id,
            ),
            SimpleNamespace(
                index_node_id="node-1",
                content="first",
                index_node_hash="hash-1",
                document_id="doc-1",
                dataset_id=dataset.id,
            ),
        ]

        with (
            patch("core.rag.datasource.keyword.jieba.jieba.JiebaKeywordTableHandler", return_value=mock_handler),
            patch(
                "core.rag.datasource.keyword.jieba.jieba.db.session.execute",
                side_effect=[
                    [SimpleNamespace(segment_id="node-2"), SimpleNamespace(segment_id="node-1")],
                    mock_segment_result,
                ],
            ),
        ):
            documents = keyword.search("query", top_k=2)

        assert [document.metadata["doc_id"] for document in documents] == ["node-2", "node-1"]

    def test_ensure_keyword_index_migrated_converts_legacy_blob_once(self):
        dataset = Mock()
        dataset.id = "dataset-123"
        dataset.dataset_keyword_table = LegacyKeywordTableState()

        keyword = Jieba(dataset)

        with (
            patch("core.rag.datasource.keyword.jieba.jieba.redis_client.lock", return_value=nullcontext()),
            patch.object(keyword, "_delete_keyword_entries_for_dataset") as mock_delete_entries,
            patch("core.rag.datasource.keyword.jieba.jieba.db.session.execute") as mock_execute,
            patch("core.rag.datasource.keyword.jieba.jieba.db.session.add") as mock_add,
            patch("core.rag.datasource.keyword.jieba.jieba.db.session.commit") as mock_commit,
        ):
            keyword._ensure_keyword_index_migrated()

        assert dataset.dataset_keyword_table.storage_version == DatasetKeywordTable.STORAGE_VERSION_NORMALIZED
        assert dataset.dataset_keyword_table.migrated_at is not None
        mock_delete_entries.assert_called_once()
        mock_execute.assert_called_once()
        inserted_rows = mock_execute.call_args.args[1]
        assert {row["keyword"] for row in inserted_rows} == {"alpha", "beta"}
        assert {row["segment_id"] for row in inserted_rows} == {"node-1", "node-2"}
        mock_add.assert_called_once_with(dataset.dataset_keyword_table)
        mock_commit.assert_called_once()
