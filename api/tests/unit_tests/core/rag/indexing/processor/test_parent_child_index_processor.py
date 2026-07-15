from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.entities.knowledge_entities import PreviewDetail
from core.rag.entities import ParentMode, Rule, Segmentation
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
from core.rag.models.document import AttachmentDocument, ChildDocument, Document


class TestParentChildIndexProcessor:
    @pytest.fixture
    def processor(self) -> ParentChildIndexProcessor:
        return ParentChildIndexProcessor()

    @pytest.fixture
    def dataset(self) -> Mock:
        dataset = Mock()
        dataset.id = "dataset-1"
        dataset.tenant_id = "tenant-1"
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.is_multimodal = True
        return dataset

    @pytest.fixture
    def dataset_document(self) -> Mock:
        document = Mock()
        document.id = "doc-1"
        document.created_by = "user-1"
        document.dataset_process_rule_id = None
        return document

    def _segmentation(self) -> SimpleNamespace:
        return SimpleNamespace(max_tokens=200, chunk_overlap=10, separator="\n")

    def _paragraph_rules(self) -> SimpleNamespace:
        return SimpleNamespace(
            parent_mode=ParentMode.PARAGRAPH,
            segmentation=self._segmentation(),
            subchunk_segmentation=self._segmentation(),
        )

    def _full_doc_rules(self) -> SimpleNamespace:
        return SimpleNamespace(
            parent_mode=ParentMode.FULL_DOC, segmentation=None, subchunk_segmentation=self._segmentation()
        )

    def test_extract_forwards_automatic_flag(self, processor: ParentChildIndexProcessor) -> None:
        extract_setting = Mock()
        session = Mock()
        expected = [Document(page_content="chunk", metadata={})]

        with patch(
            "core.rag.index_processor.processor.parent_child_index_processor.ExtractProcessor.extract"
        ) as mock_extract:
            mock_extract.return_value = expected
            documents = processor.extract(extract_setting, process_rule_mode="hierarchical", session=session)

        assert documents == expected
        mock_extract.assert_called_once_with(extract_setting=extract_setting, is_automatic=True, session=session)

    def test_transform_validates_process_rule(self, processor: ParentChildIndexProcessor) -> None:
        session = MagicMock()
        with pytest.raises(ValueError, match="No process rule found"):
            processor.transform([Document(page_content="text", metadata={})], process_rule=None, session=session)

        with pytest.raises(ValueError, match="No rules found in process rule"):
            processor.transform(
                [Document(page_content="text", metadata={})], process_rule={"mode": "custom"}, session=session
            )

    def test_transform_paragraph_requires_segmentation(self, processor: ParentChildIndexProcessor) -> None:
        rules = SimpleNamespace(parent_mode=ParentMode.PARAGRAPH, segmentation=None)

        with patch(
            "core.rag.index_processor.processor.parent_child_index_processor.Rule.model_validate", return_value=rules
        ):
            with pytest.raises(ValueError, match="No segmentation found in rules"):
                processor.transform(
                    [Document(page_content="text", metadata={})],
                    process_rule={"mode": "custom", "rules": {"enabled": True}},
                    session=MagicMock(),
                )

    def test_transform_paragraph_builds_parent_and_child_docs(self, processor: ParentChildIndexProcessor) -> None:
        splitter = Mock()
        splitter.split_documents.return_value = [
            Document(page_content=".parent", metadata={}),
            Document(page_content=" ", metadata={}),
        ]
        parent_document = Document(page_content="source", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"})
        child_docs = [ChildDocument(page_content="child-1", metadata={"dataset_id": "dataset-1"})]

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.Rule.model_validate",
                return_value=self._paragraph_rules(),
            ),
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.CleanProcessor.clean",
                return_value=".parent",
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="image", metadata={})]
            ),
            patch.object(processor, "_split_child_nodes", return_value=child_docs),
        ):
            result = processor.transform(
                [parent_document],
                process_rule={"mode": "custom", "rules": {"enabled": True}},
                preview=False,
                session=MagicMock(),
            )

        assert len(result) == 1
        assert result[0].page_content == "parent"
        assert result[0].children == child_docs
        assert result[0].attachments is not None

    def test_transform_preview_returns_after_ten_parent_chunks(self, processor: ParentChildIndexProcessor) -> None:
        splitter = Mock()
        splitter.split_documents.return_value = [Document(page_content=f"chunk-{i}", metadata={}) for i in range(10)]
        documents = [
            Document(page_content="doc-1", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"}),
            Document(page_content="doc-2", metadata={"dataset_id": "dataset-1", "document_id": "doc-2"}),
        ]

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.Rule.model_validate",
                return_value=self._paragraph_rules(),
            ),
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.CleanProcessor.clean",
                side_effect=lambda text, _: text,
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch.object(processor, "_get_content_files", return_value=[]),
            patch.object(processor, "_split_child_nodes", return_value=[]),
        ):
            result = processor.transform(
                documents,
                process_rule={"mode": "custom", "rules": {"enabled": True}},
                preview=True,
                session=MagicMock(),
            )

        assert len(result) == 10

    def test_transform_full_doc_mode_trims_children_for_preview(self, processor: ParentChildIndexProcessor) -> None:
        docs = [
            Document(page_content="first", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"}),
            Document(page_content="second", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"}),
        ]
        child_docs = [ChildDocument(page_content=f"child-{i}", metadata={}) for i in range(5)]

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.Rule.model_validate",
                return_value=self._full_doc_rules(),
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="image", metadata={})]
            ),
            patch.object(processor, "_split_child_nodes", return_value=child_docs),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.dify_config.CHILD_CHUNKS_PREVIEW_NUMBER",
                2,
            ),
        ):
            result = processor.transform(
                docs,
                process_rule={"mode": "hierarchical", "rules": {"enabled": True}},
                preview=True,
                session=MagicMock(),
            )

        assert len(result) == 1
        assert len(result[0].children or []) == 2
        assert result[0].attachments is not None

    def test_load_creates_vectors_for_child_docs(self, processor: ParentChildIndexProcessor, dataset: Mock) -> None:
        parent_doc = Document(
            page_content="parent",
            metadata={},
            children=[
                ChildDocument(page_content="child-1", metadata={}),
                ChildDocument(page_content="child-2", metadata={}),
            ],
        )
        multimodal_docs = [AttachmentDocument(page_content="image", metadata={})]
        session = MagicMock()

        with patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as mock_vector_cls:
            vector = mock_vector_cls.return_value
            processor.load(dataset, [parent_doc], multimodal_documents=multimodal_docs, session=session)

        mock_vector_cls.assert_called_once_with(dataset, session=session)
        assert vector.create.call_count == 1
        formatted_docs = vector.create.call_args[0][0]
        assert len(formatted_docs) == 2
        assert all(isinstance(doc, Document) for doc in formatted_docs)
        vector.create_multimodal.assert_called_once_with(multimodal_docs)

    def test_clean_with_precomputed_child_ids(self, processor: ParentChildIndexProcessor, dataset: Mock) -> None:
        session = MagicMock()

        with (
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(
                dataset,
                ["node-1"],
                delete_child_chunks=True,
                precomputed_child_node_ids=["child-1", "child-2"],
                session=session,
            )

        vector.delete_by_ids.assert_called_once_with(["child-1", "child-2"])
        session.execute.assert_called()
        session.flush.assert_called_once()

    def test_clean_queries_child_ids_when_not_precomputed(
        self, processor: ParentChildIndexProcessor, dataset: Mock
    ) -> None:
        execute_result = Mock()
        execute_result.all.return_value = [("child-1",), (None,), ("child-2",)]
        session = MagicMock()
        session.execute.return_value = execute_result

        with (
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(dataset, ["node-1"], delete_child_chunks=False, session=session)

        vector.delete_by_ids.assert_called_once_with(["child-1", "child-2"])

    def test_clean_dataset_wide_cleanup(self, processor: ParentChildIndexProcessor, dataset: Mock) -> None:
        session = MagicMock()

        with (
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(dataset, None, delete_child_chunks=True, session=session)

        vector.delete.assert_called_once()
        session.execute.assert_called()
        session.flush.assert_called_once()

    def test_clean_deletes_summaries_when_requested(self, processor: ParentChildIndexProcessor, dataset: Mock) -> None:
        scalars_result = Mock()
        scalars_result.all.return_value = [SimpleNamespace(id="seg-1")]
        session = MagicMock()
        session.scalars.return_value = scalars_result
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = False

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector"),
        ):
            processor.clean(dataset, ["node-1"], delete_summaries=True, precomputed_child_node_ids=[], session=session)

        mock_summary.assert_called_once_with(dataset, ["seg-1"], session=session)

    def test_clean_deletes_all_summaries_when_node_ids_missing(
        self, processor: ParentChildIndexProcessor, dataset: Mock
    ) -> None:
        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector"),
        ):
            session = MagicMock()
            processor.clean(dataset, None, delete_summaries=True, session=session)

        mock_summary.assert_called_once_with(dataset, None, session=session)

    def test_split_child_nodes_requires_subchunk_segmentation(self, processor: ParentChildIndexProcessor) -> None:
        rules = Rule(subchunk_segmentation=None)

        with pytest.raises(ValueError, match="No subchunk segmentation found"):
            processor._split_child_nodes(Document(page_content="parent", metadata={}), rules, "custom", None)

    def test_split_child_nodes_generates_child_documents(self, processor: ParentChildIndexProcessor) -> None:
        rules = Rule(subchunk_segmentation=Segmentation(max_tokens=200, chunk_overlap=10, separator="\n"))
        splitter = Mock()
        splitter.split_documents.return_value = [
            Document(page_content=".child-1", metadata={}),
            Document(page_content=" ", metadata={}),
        ]

        with (
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
        ):
            child_docs = processor._split_child_nodes(
                Document(page_content="parent", metadata={}), rules, "custom", None
            )

        assert len(child_docs) == 1
        assert child_docs[0].page_content == "child-1"
        assert child_docs[0].metadata["doc_hash"] == "hash"

    def test_index_creates_process_rule_segments_and_vectors(
        self, processor: ParentChildIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        parent_childs = SimpleNamespace(
            parent_mode=ParentMode.PARAGRAPH,
            parent_child_chunks=[
                SimpleNamespace(
                    parent_content="parent text",
                    child_contents=["child-1", "child-2"],
                    files=[SimpleNamespace(id="file-1", filename="image.png")],
                )
            ],
        )
        dataset_rule = SimpleNamespace(id="rule-1")
        session = MagicMock()
        phase_events: list[str] = []
        session.commit.side_effect = lambda: phase_events.append("commit")

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.ParentChildStructureChunk.model_validate",
                return_value=parent_childs,
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.DatasetProcessRule",
                return_value=dataset_rule,
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                side_effect=lambda text: f"hash-{text}",
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.DatasetDocumentStore"
            ) as mock_store_cls,
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector") as mock_vector_cls,
        ):
            mock_store_cls.return_value.add_documents.side_effect = lambda **_kwargs: phase_events.append("store")
            mock_vector_cls.return_value.create.side_effect = lambda _documents: phase_events.append("vector")
            processor.index(dataset, dataset_document, {"parent_child_chunks": []}, session)

        assert phase_events == ["store", "commit", "vector"]
        assert dataset_document.dataset_process_rule_id == "rule-1"
        session.add.assert_called_once_with(dataset_rule)
        session.flush.assert_called_once()
        mock_store_cls.return_value.add_documents.assert_called_once()
        mock_vector_cls.assert_called_once_with(dataset, session=session)
        assert mock_vector_cls.return_value.create.call_count == 1
        mock_vector_cls.return_value.create_multimodal.assert_called_once()

    def test_index_uses_content_files_when_files_missing(
        self, processor: ParentChildIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        parent_childs = SimpleNamespace(
            parent_mode=ParentMode.PARAGRAPH,
            parent_child_chunks=[SimpleNamespace(parent_content="parent", child_contents=["child"], files=None)],
        )
        dataset_rule = SimpleNamespace(id="rule-1")
        session = MagicMock()
        account_session = MagicMock()

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.ParentChildStructureChunk.model_validate",
                return_value=parent_childs,
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.DatasetProcessRule",
                return_value=dataset_rule,
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.AccountService.load_user",
                return_value=SimpleNamespace(id="user-1"),
            ) as load_user,
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.session_factory.create_session",
                return_value=nullcontext(account_session),
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="image", metadata={})]
            ) as mock_files,
            patch("core.rag.index_processor.processor.parent_child_index_processor.DatasetDocumentStore"),
            patch("core.rag.index_processor.processor.parent_child_index_processor.Vector"),
        ):
            processor.index(dataset, dataset_document, {"parent_child_chunks": []}, session)

        mock_files.assert_called_once()
        load_user.assert_called_once_with(dataset_document.created_by, account_session)
        assert account_session is not session

    def test_index_raises_when_account_missing(
        self, processor: ParentChildIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        parent_childs = SimpleNamespace(
            parent_mode=ParentMode.PARAGRAPH,
            parent_child_chunks=[SimpleNamespace(parent_content="parent", child_contents=["child"], files=None)],
        )

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.ParentChildStructureChunk.model_validate",
                return_value=parent_childs,
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.AccountService.load_user",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError, match="Invalid account"):
                processor.index(dataset, dataset_document, {"parent_child_chunks": []}, MagicMock())

    def test_format_preview_returns_parent_child_structure(self, processor: ParentChildIndexProcessor) -> None:
        parent_childs = SimpleNamespace(
            parent_mode=ParentMode.PARAGRAPH,
            parent_child_chunks=[SimpleNamespace(parent_content="parent", child_contents=["child-1", "child-2"])],
        )

        with patch(
            "core.rag.index_processor.processor.parent_child_index_processor.ParentChildStructureChunk.model_validate",
            return_value=parent_childs,
        ):
            preview = processor.format_preview({"parent_child_chunks": []})

        assert preview["chunk_structure"] == "hierarchical_model"
        assert preview["parent_mode"] == ParentMode.PARAGRAPH
        assert preview["total_segments"] == 1

    def test_generate_summary_preview_sets_summaries(self, processor: ParentChildIndexProcessor) -> None:
        preview_texts = [PreviewDetail(content="chunk-1"), PreviewDetail(content="chunk-2")]
        session = MagicMock()
        worker_sessions = [MagicMock(), MagicMock()]

        with (
            patch(
                "core.rag.index_processor.processor.parent_child_index_processor.session_factory.create_session",
                side_effect=[nullcontext(worker_session) for worker_session in worker_sessions],
            ) as create_session,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ParagraphIndexProcessor.generate_summary",
                return_value=("summary", None),
            ) as mock_generate_summary,
        ):
            result = processor.generate_summary_preview(
                "tenant-1", preview_texts, {"enable": True}, doc_language="English", session=session
            )

        assert all(item.summary == "summary" for item in result)
        call_sessions = [call.kwargs["session"] for call in mock_generate_summary.call_args_list]
        assert create_session.call_count == len(preview_texts)
        assert all(call_session is not session for call_session in call_sessions)
        assert {id(call_session) for call_session in call_sessions} == {
            id(worker_session) for worker_session in worker_sessions
        }

    def test_generate_summary_preview_raises_when_worker_fails(self, processor: ParentChildIndexProcessor) -> None:
        preview_texts = [PreviewDetail(content="chunk-1")]

        with patch(
            "core.rag.index_processor.processor.paragraph_index_processor.ParagraphIndexProcessor.generate_summary",
            side_effect=RuntimeError("summary failed"),
        ):
            with pytest.raises(ValueError, match="Failed to generate summaries"):
                processor.generate_summary_preview("tenant-1", preview_texts, {"enable": True}, session=MagicMock())

    def test_generate_summary_preview_falls_back_without_flask_context(
        self, processor: ParentChildIndexProcessor
    ) -> None:
        preview_texts = [PreviewDetail(content="chunk-1")]
        fake_current_app = SimpleNamespace(_get_current_object=Mock(side_effect=RuntimeError("no app")))

        with (
            patch("flask.current_app", fake_current_app),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ParagraphIndexProcessor.generate_summary",
                return_value=("summary", None),
            ),
        ):
            result = processor.generate_summary_preview(
                "tenant-1", preview_texts, {"enable": True}, session=MagicMock()
            )

        assert result[0].summary == "summary"

    def test_generate_summary_preview_handles_timeout(
        self, processor: ParentChildIndexProcessor, fake_executor_cls: type
    ) -> None:
        preview_texts = [PreviewDetail(content="chunk-1")]
        future = Mock()
        executor = fake_executor_cls(future)

        with (
            patch("concurrent.futures.ThreadPoolExecutor", return_value=executor),
            patch("concurrent.futures.wait", side_effect=[(set(), {future}), (set(), set())]),
        ):
            with pytest.raises(ValueError, match="timeout"):
                processor.generate_summary_preview("tenant-1", preview_texts, {"enable": True}, session=MagicMock())

        future.cancel.assert_called_once()
