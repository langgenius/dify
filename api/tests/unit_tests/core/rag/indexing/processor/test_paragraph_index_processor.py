import logging
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.entities.knowledge_entities import PreviewDetail
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import AttachmentDocument, Document
from extensions.storage.storage_type import StorageType
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, ImagePromptMessageContent
from graphon.model_runtime.entities.model_entities import ModelFeature
from models.enums import CreatorUserRole
from models.model import UploadFile


def _upload_file(
    file_id: str,
    *,
    name: str = "image.png",
    extension: str = "png",
    mime_type: str = "image/png",
    key: str = "key",
) -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name=name,
        size=1,
        extension=extension,
        mime_type=mime_type,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="00000000-0000-0000-0000-000000000001",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


class TestParagraphIndexProcessor:
    @pytest.fixture
    def processor(self) -> ParagraphIndexProcessor:
        return ParagraphIndexProcessor()

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
        return document

    @pytest.fixture
    def process_rule(self) -> dict:
        return {
            "mode": "custom",
            "rules": {"segmentation": {"max_tokens": 256, "chunk_overlap": 10, "separator": "\n"}},
        }

    def _rules(self) -> SimpleNamespace:
        segmentation = SimpleNamespace(max_tokens=256, chunk_overlap=10, separator="\n")
        return SimpleNamespace(segmentation=segmentation)

    def _llm_result(self, content: str = "summary") -> LLMResult:
        return LLMResult(
            model="llm-model",
            message=AssistantPromptMessage(content=content),
            usage=LLMUsage.empty_usage(),
        )

    def test_extract_forwards_automatic_flag(self, processor: ParagraphIndexProcessor) -> None:
        extract_setting = Mock()
        session = Mock()
        expected_docs = [Document(page_content="chunk", metadata={})]

        with patch(
            "core.rag.index_processor.processor.paragraph_index_processor.ExtractProcessor.extract"
        ) as mock_extract:
            mock_extract.return_value = expected_docs
            docs = processor.extract(extract_setting, process_rule_mode="hierarchical", session=session)

        assert docs == expected_docs
        mock_extract.assert_called_once_with(extract_setting=extract_setting, is_automatic=True, session=session)

    def test_transform_validates_process_rule(self, processor: ParagraphIndexProcessor) -> None:
        session = Mock()
        with pytest.raises(ValueError, match="No process rule found"):
            processor.transform([Document(page_content="text", metadata={})], process_rule=None, session=session)

        with pytest.raises(ValueError, match="No rules found in process rule"):
            processor.transform(
                [Document(page_content="text", metadata={})], process_rule={"mode": "custom"}, session=session
            )

    def test_transform_validates_segmentation(
        self, processor: ParagraphIndexProcessor, process_rule: dict[str, Any]
    ) -> None:
        rules_without_segmentation = SimpleNamespace(segmentation=None)
        session = Mock()

        with patch(
            "core.rag.index_processor.processor.paragraph_index_processor.Rule.model_validate",
            return_value=rules_without_segmentation,
        ):
            with pytest.raises(ValueError, match="No segmentation found in rules"):
                processor.transform(
                    [Document(page_content="text", metadata={})],
                    process_rule={"mode": "custom", "rules": {"enabled": True}},
                    session=session,
                )

    def test_transform_builds_split_documents(
        self, processor: ParagraphIndexProcessor, process_rule: dict[str, Any]
    ) -> None:
        source_document = Document(page_content="source", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"})
        session = Mock()
        splitter = Mock()
        splitter.split_documents.return_value = [
            Document(page_content=".first", metadata={}),
            Document(page_content=" ", metadata={}),
        ]

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.Rule.model_validate",
                return_value=self._rules(),
            ),
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.CleanProcessor.clean",
                return_value=".first",
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.remove_leading_symbols",
                side_effect=lambda text: text.lstrip("."),
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="image", metadata={})]
            ),
        ):
            documents = processor.transform([source_document], process_rule=process_rule, session=session)

        assert len(documents) == 1
        assert documents[0].page_content == "first"
        assert documents[0].attachments is not None
        assert documents[0].metadata["doc_hash"] == "hash"

    def test_transform_automatic_mode_uses_default_rules(self, processor: ParagraphIndexProcessor) -> None:
        splitter = Mock()
        splitter.split_documents.return_value = [Document(page_content="text", metadata={})]
        session = Mock()

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.Rule.model_validate",
                return_value=self._rules(),
            ) as mock_validate,
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.CleanProcessor.clean",
                side_effect=lambda text, _: text,
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.remove_leading_symbols",
                side_effect=lambda text: text,
            ),
            patch.object(processor, "_get_content_files", return_value=[]),
        ):
            processor.transform(
                [Document(page_content="text", metadata={})],
                process_rule={"mode": "automatic"},
                session=session,
            )

        assert mock_validate.call_count == 1

    def test_load_creates_vector_and_multimodal_when_high_quality(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        docs = [Document(page_content="chunk", metadata={})]
        multimodal_docs = [AttachmentDocument(page_content="image", metadata={})]
        session = Mock()

        with (
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls,
        ):
            processor.load(dataset, docs, multimodal_documents=multimodal_docs, session=session)
        mock_vector_cls.assert_called_once_with(dataset)
        vector = mock_vector_cls.return_value
        vector.create.assert_called_once_with(docs)
        vector.create_multimodal.assert_called_once_with(multimodal_docs)
        mock_keyword_cls.assert_not_called()

    def test_load_uses_keyword_add_texts_with_keywords_when_economy(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        docs = [Document(page_content="chunk", metadata={})]
        session = Mock()
        keywords_list = [["k1"], ["k2"]]

        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.load(dataset, docs, keywords_list=keywords_list, session=session)

        mock_keyword_cls.return_value.add_texts.assert_called_once_with(docs, session, keywords_list=keywords_list)

    def test_load_uses_keyword_add_texts_without_keywords_when_economy(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        docs = [Document(page_content="chunk", metadata={})]
        session = Mock()

        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.load(dataset, docs, session=session)

        mock_keyword_cls.return_value.add_texts.assert_called_once_with(docs, session)

    def test_clean_deletes_summaries_and_vector(self, processor: ParagraphIndexProcessor, dataset: Mock) -> None:
        scalars_result = Mock()
        scalars_result.all.return_value = [SimpleNamespace(id="seg-1")]
        session = Mock()
        session.scalars.return_value = scalars_result

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(dataset, ["node-1"], delete_summaries=True, segment_ids=["seg-1"], session=session)

        mock_summary.assert_called_once_with(dataset=dataset, segment_ids=["seg-1"], session=session)
        vector.delete_by_ids.assert_called_once_with(["node-1"])

    def test_clean_economy_deletes_summaries_and_keywords(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        session = Mock()

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls,
        ):
            processor.clean(dataset, None, delete_summaries=True, session=session)

        mock_summary.assert_called_once_with(dataset=dataset, segment_ids=None, session=session)
        mock_keyword_cls.return_value.delete.assert_called_once()

    def test_clean_deletes_keywords_by_ids(self, processor: ParagraphIndexProcessor, dataset: Mock) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        session = Mock()
        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.clean(dataset, ["node-2"], with_keywords=True, session=session)

        mock_keyword_cls.return_value.delete_by_ids.assert_called_once_with(["node-2"], session)

    def test_clean_empty_partial_selection_does_not_delete_vector_index(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        session = Mock()
        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
        ):
            processor.clean(dataset, [], delete_summaries=True, segment_ids=[], session=session)

        mock_summary.assert_called_once_with(dataset=dataset, segment_ids=[], session=session)
        mock_vector_cls.assert_not_called()

    def test_clean_rejects_partial_summary_cleanup_without_durable_segment_ids(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        with pytest.raises(ValueError, match="segment_ids are required"):
            processor.clean(dataset, ["node-1"], delete_summaries=True, session=Mock())

    def test_clean_empty_partial_selection_does_not_delete_keyword_index(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        session = Mock()
        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.clean(dataset, [], with_keywords=True, session=session)

        mock_keyword_cls.assert_not_called()

    def test_index_list_chunks_high_quality(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        session = Mock()
        phase_events: list[str] = []
        session.commit.side_effect = lambda: phase_events.append("commit")
        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="img", metadata={})]
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.DatasetDocumentStore"
            ) as mock_store_cls,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.calculate_segment_token_counts"
            ) as mock_token_counter,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
        ):
            mock_token_counter.side_effect = lambda **_kwargs: phase_events.append("count") or [11, 22]
            mock_store_cls.return_value.add_documents.side_effect = lambda **_kwargs: phase_events.append("store")
            mock_vector_cls.return_value.create.side_effect = lambda _documents: phase_events.append("vector")
            processor.index(dataset, dataset_document, ["chunk-1", "chunk-2"], session)

        assert phase_events == ["commit", "count", "store", "commit", "vector"]
        documents = mock_token_counter.call_args.kwargs["documents"]
        assert [document.page_content for document in documents] == ["chunk-1", "chunk-2"]
        mock_token_counter.assert_called_once_with(dataset=dataset, documents=documents)
        mock_store_cls.return_value.add_documents.assert_called_once_with(
            session=session,
            docs=documents,
            token_counts=[11, 22],
            save_child=False,
        )
        mock_vector_cls.assert_called_once_with(dataset)
        mock_vector_cls.return_value.create.assert_called_once()
        mock_vector_cls.return_value.create_multimodal.assert_called_once()

    def test_index_list_chunks_economy(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        session = Mock()
        phase_events: list[str] = []
        session.commit.side_effect = lambda: phase_events.append("commit")
        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch.object(processor, "_get_content_files", return_value=[]),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.DatasetDocumentStore"
            ) as mock_store_cls,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.calculate_segment_token_counts"
            ) as mock_token_counter,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls,
        ):
            mock_token_counter.side_effect = lambda **_kwargs: phase_events.append("count") or [0]
            mock_store_cls.return_value.add_documents.side_effect = lambda **_kwargs: phase_events.append("store")
            mock_keyword_cls.return_value.add_texts.side_effect = lambda *_args: phase_events.append("keyword")
            processor.index(dataset, dataset_document, ["chunk-3"], session)

        assert phase_events == ["count", "store", "commit", "keyword"]
        mock_token_counter.assert_called_once()
        mock_keyword_cls.return_value.add_texts.assert_called_once()

    def test_index_multimodal_structure_handles_files_and_account_lookup(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        chunk_with_files = SimpleNamespace(
            content="content-1",
            files=[SimpleNamespace(id="file-1", filename="image.png")],
        )
        chunk_without_files = SimpleNamespace(content="content-2", files=None)
        structure = SimpleNamespace(general_chunks=[chunk_with_files, chunk_without_files])
        session = Mock()
        account_session = Mock()

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.MultimodalGeneralStructureChunk.model_validate",
                return_value=structure,
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.AccountService.load_user",
                return_value=SimpleNamespace(id="user-1"),
            ) as load_user,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.session_factory.create_session",
                return_value=nullcontext(account_session),
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="img", metadata={})]
            ) as mock_files,
            patch("core.rag.index_processor.processor.paragraph_index_processor.DatasetDocumentStore"),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.calculate_segment_token_counts",
                return_value=[11, 22],
            ),
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector"),
        ):
            processor.index(dataset, dataset_document, {"general_chunks": []}, session)

        assert mock_files.call_count == 1
        load_user.assert_called_once_with(dataset_document.created_by, account_session)
        assert account_session is not session

    def test_index_multimodal_structure_requires_valid_account(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        structure = SimpleNamespace(general_chunks=[SimpleNamespace(content="content", files=None)])
        session = Mock()

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.MultimodalGeneralStructureChunk.model_validate",
                return_value=structure,
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.AccountService.load_user",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError, match="Invalid account"):
                processor.index(dataset, dataset_document, {"general_chunks": []}, session)

    def test_format_preview_validates_chunk_shape(self, processor: ParagraphIndexProcessor) -> None:
        preview = processor.format_preview(["chunk-1", "chunk-2"])
        assert preview["chunk_structure"] == "text_model"
        assert preview["total_segments"] == 2

        with pytest.raises(ValueError, match="Chunks is not a list"):
            processor.format_preview({"not": "a-list"})

    def test_generate_summary_preview_success_and_failure(self, processor: ParagraphIndexProcessor) -> None:
        preview_items = [PreviewDetail(content="chunk-1"), PreviewDetail(content="chunk-2")]
        session = Mock()

        with patch.object(
            processor, "generate_summary", return_value=("summary", LLMUsage.empty_usage())
        ) as mock_generate_summary:
            result = processor.generate_summary_preview(
                "tenant-1", preview_items, {"enable": True}, doc_language="English", session=session
            )
        assert all(item.summary == "summary" for item in result)
        assert all("session" not in call.kwargs for call in mock_generate_summary.call_args_list)

        with patch.object(processor, "generate_summary", side_effect=RuntimeError("summary failed")):
            with pytest.raises(ValueError, match="Failed to generate summaries"):
                processor.generate_summary_preview(
                    "tenant-1", [PreviewDetail(content="chunk-1")], {"enable": True}, session=session
                )

    def test_generate_summary_preview_fallback_without_flask_context(self, processor: ParagraphIndexProcessor) -> None:
        preview_items = [PreviewDetail(content="chunk-1")]
        fake_current_app = SimpleNamespace(_get_current_object=Mock(side_effect=RuntimeError("no app")))

        with (
            patch("flask.current_app", fake_current_app),
            patch.object(processor, "generate_summary", return_value=("summary", LLMUsage.empty_usage())),
        ):
            result = processor.generate_summary_preview("tenant-1", preview_items, {"enable": True}, session=Mock())

        assert result[0].summary == "summary"

    def test_generate_summary_preview_timeout(
        self, processor: ParagraphIndexProcessor, fake_executor_cls: type
    ) -> None:
        preview_items = [PreviewDetail(content="chunk-1")]
        future = Mock()
        executor = fake_executor_cls(future)

        with (
            patch("concurrent.futures.ThreadPoolExecutor", return_value=executor),
            patch("concurrent.futures.wait", side_effect=[(set(), {future}), (set(), set())]),
        ):
            with pytest.raises(ValueError, match="timeout"):
                processor.generate_summary_preview("tenant-1", preview_items, {"enable": True}, session=Mock())

        future.cancel.assert_called_once()

    def test_generate_summary_validates_input(self) -> None:
        with pytest.raises(ValueError, match="must be enabled"):
            ParagraphIndexProcessor.generate_summary("tenant-1", "text", {"enable": False})

        with pytest.raises(ValueError, match="model_name and model_provider_name"):
            ParagraphIndexProcessor.generate_summary("tenant-1", "text", {"enable": True})

    def test_generate_summary_text_only_flow(self, caplog: pytest.LogCaptureFixture) -> None:
        model_instance = Mock()
        model_instance.credentials = {"k": "v"}
        model_instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(features=[])
        model_instance.invoke_llm.return_value = self._llm_result("text summary")

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.create_plugin_provider_manager"
            ) as mock_provider_manager,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ModelInstance",
                return_value=model_instance,
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.deduct_llm_quota",
                side_effect=RuntimeError("quota"),
            ),
        ):
            mock_provider_manager.return_value.get_provider_model_bundle.return_value = Mock()
            with caplog.at_level(
                logging.WARNING, logger="core.rag.index_processor.processor.paragraph_index_processor"
            ):
                summary, usage = ParagraphIndexProcessor.generate_summary(
                    "tenant-1",
                    "text content",
                    {"enable": True, "model_name": "model-a", "model_provider_name": "provider-a"},
                    document_language="English",
                )

        assert summary == "text summary"
        assert isinstance(usage, LLMUsage)
        assert sum(1 for r in caplog.records if r.levelno == logging.WARNING) == 1
        assert any("Failed to deduct quota for summary generation" in record.message for record in caplog.records)

    def test_generate_summary_handles_vision_and_image_conversion(self) -> None:
        events: list[str] = []
        model_instance = Mock()
        model_instance.credentials = {"k": "v"}
        model_instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(
            features=[ModelFeature.VISION]
        )
        image_file = SimpleNamespace()
        image_content = ImagePromptMessageContent(format="url", mime_type="image/png", url="http://example.com/a.png")
        image_session = Mock()
        image_session_context = MagicMock()
        image_session_context.__enter__.side_effect = lambda: events.append("open") or image_session
        image_session_context.__exit__.side_effect = lambda *_args: events.append("close")

        def extract_images(*_args):
            events.append("lookup")
            return [image_file]

        def convert_image(*_args, **_kwargs):
            assert events[-1] == "close"
            events.append("storage")
            return image_content

        def invoke_llm(**_kwargs):
            assert "close" in events
            events.append("llm")
            return self._llm_result("vision summary")

        model_instance.invoke_llm.side_effect = invoke_llm

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.create_plugin_provider_manager"
            ) as mock_provider_manager,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ModelInstance",
                return_value=model_instance,
            ),
            patch.object(
                ParagraphIndexProcessor,
                "_extract_images_from_segment_attachments",
                side_effect=extract_images,
            ),
            patch.object(ParagraphIndexProcessor, "_extract_images_from_text", return_value=[]) as mock_extract_text,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.file_manager.to_prompt_message_content",
                side_effect=convert_image,
            ),
            patch("core.rag.index_processor.processor.paragraph_index_processor.deduct_llm_quota"),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.session_factory.create_session",
                return_value=image_session_context,
            ),
        ):
            mock_provider_manager.return_value.get_provider_model_bundle.return_value = Mock()
            summary, _ = ParagraphIndexProcessor.generate_summary(
                "tenant-1",
                "text content",
                {"enable": True, "model_name": "model-a", "model_provider_name": "provider-a"},
                segment_id="seg-1",
            )

        assert summary == "vision summary"
        assert events == ["open", "lookup", "close", "storage", "llm"]
        mock_extract_text.assert_not_called()

    def test_generate_summary_fallbacks_for_prompt_and_result_types(self, caplog: pytest.LogCaptureFixture) -> None:
        model_instance = Mock()
        model_instance.credentials = {"k": "v"}
        model_instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(
            features=[ModelFeature.VISION]
        )
        model_instance.invoke_llm.return_value = object()
        image_file = SimpleNamespace()

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.create_plugin_provider_manager"
            ) as mock_provider_manager,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ModelInstance",
                return_value=model_instance,
            ),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.DEFAULT_GENERATOR_SUMMARY_PROMPT",
                "Prompt {missing}",
            ),
            patch.object(ParagraphIndexProcessor, "_extract_images_from_segment_attachments", return_value=[]),
            patch.object(ParagraphIndexProcessor, "_extract_images_from_text", return_value=[image_file]),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.file_manager.to_prompt_message_content",
                side_effect=RuntimeError("bad image"),
            ),
            patch("core.rag.index_processor.processor.paragraph_index_processor.session_factory.create_session"),
        ):
            mock_provider_manager.return_value.get_provider_model_bundle.return_value = Mock()
            with pytest.raises(ValueError, match="Expected LLMResult"):
                with caplog.at_level(
                    logging.WARNING, logger="core.rag.index_processor.processor.paragraph_index_processor"
                ):
                    ParagraphIndexProcessor.generate_summary(
                        "tenant-1",
                        "text content",
                        {"enable": True, "model_name": "model-a", "model_provider_name": "provider-a"},
                    )

        assert sum(1 for r in caplog.records if r.levelno == logging.WARNING) == 1
        assert any(
            "Failed to convert image file to prompt message content" in record.message for record in caplog.records
        )

    def test_extract_images_from_text_handles_patterns_and_build_errors(self, caplog: pytest.LogCaptureFixture) -> None:
        text = (
            "![img](/files/11111111-1111-1111-1111-111111111111/image-preview) "
            "![img2](/files/22222222-2222-2222-2222-222222222222/file-preview) "
            "![tool](/files/tools/33333333-3333-3333-3333-333333333333.png)"
        )
        image_upload = _upload_file("11111111-1111-1111-1111-111111111111")
        non_image_upload = _upload_file(
            "22222222-2222-2222-2222-222222222222",
            name="file.txt",
            extension="txt",
            mime_type="text/plain",
        )
        scalars_result = Mock()
        scalars_result.all.return_value = [image_upload, non_image_upload]
        session = Mock()
        session.scalars.return_value = scalars_result

        with caplog.at_level(logging.WARNING, logger="core.rag.index_processor.processor.paragraph_index_processor"):
            files = ParagraphIndexProcessor._extract_images_from_text("tenant-1", text, session)

        assert len(files) == 1
        assert files[0].id == image_upload.id
        assert not any(record.levelno == logging.WARNING for record in caplog.records)

    def test_extract_images_from_text_returns_empty_when_no_matches(self) -> None:
        scalars_result = Mock()
        scalars_result.all.return_value = []
        session = Mock()
        session.scalars.return_value = scalars_result
        assert ParagraphIndexProcessor._extract_images_from_text("tenant-1", "no images here", session) == []

    def test_extract_images_from_text_preserves_end_user_file_scope(self) -> None:
        text = "![img](/files/11111111-1111-1111-1111-111111111111/image-preview)"
        session = Mock()
        session.scalars.return_value.all.return_value = []
        scope = FileAccessScope(
            tenant_id="tenant-1",
            user_id="end-user-1",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        with bind_file_access_scope(scope):
            ParagraphIndexProcessor._extract_images_from_text("tenant-1", text, session)

        statement_sql = str(session.scalars.call_args.args[0].whereclause)
        assert "upload_files.created_by_role" in statement_sql
        assert "upload_files.created_by" in statement_sql

    def test_extract_images_from_text_logs_when_build_fails(self, caplog: pytest.LogCaptureFixture) -> None:
        text = "![img](/files/11111111-1111-1111-1111-111111111111/image-preview)"
        image_upload = _upload_file("11111111-1111-1111-1111-111111111111")
        scalars_result = Mock()
        scalars_result.all.return_value = [image_upload]
        session = Mock()
        session.scalars.return_value = scalars_result

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.File",
                side_effect=RuntimeError("build failed"),
            ),
            caplog.at_level(logging.WARNING, logger="core.rag.index_processor.processor.paragraph_index_processor"),
        ):
            files = ParagraphIndexProcessor._extract_images_from_text("tenant-1", text, session)

        assert files == []
        assert sum(1 for r in caplog.records if r.levelno == logging.WARNING) == 1

    def test_extract_images_from_segment_attachments(self, caplog: pytest.LogCaptureFixture) -> None:
        image_upload = _upload_file("file-1", name="image", key="k1")
        bad_upload = _upload_file("file-2", name="broken", key="k2")
        bad_upload.extension = None  # type: ignore[assignment]
        non_image_upload = _upload_file(
            "file-3",
            name="text",
            extension="txt",
            mime_type="text/plain",
            key="k3",
        )
        scalars_result = Mock()
        scalars_result.all.return_value = [image_upload, bad_upload, non_image_upload]
        session = Mock()
        session.scalars.return_value = scalars_result

        with caplog.at_level(logging.WARNING, logger="core.rag.index_processor.processor.paragraph_index_processor"):
            files = ParagraphIndexProcessor._extract_images_from_segment_attachments("tenant-1", "seg-1", session)

        assert len(files) == 1
        assert sum(1 for r in caplog.records if r.levelno == logging.WARNING) == 1
        statement = session.scalars.call_args.args[0]
        assert "upload_files.tenant_id" in str(statement)

    def test_extract_images_from_segment_attachments_empty(self) -> None:
        scalars_result = Mock()
        scalars_result.all.return_value = []
        session = Mock()
        session.scalars.return_value = scalars_result

        empty_files = ParagraphIndexProcessor._extract_images_from_segment_attachments("tenant-1", "seg-1", session)

        assert empty_files == []

    def test_extract_images_from_segment_attachments_preserves_end_user_file_scope(self) -> None:
        session = Mock()
        session.scalars.return_value.all.return_value = []
        scope = FileAccessScope(
            tenant_id="tenant-1",
            user_id="end-user-1",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        with bind_file_access_scope(scope):
            ParagraphIndexProcessor._extract_images_from_segment_attachments("tenant-1", "seg-1", session)

        statement_sql = str(session.scalars.call_args.args[0].whereclause)
        assert "upload_files.created_by_role" in statement_sql
        assert "upload_files.created_by" in statement_sql
