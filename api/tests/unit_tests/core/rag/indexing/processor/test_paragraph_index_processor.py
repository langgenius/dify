from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, ImagePromptMessageContent
from graphon.model_runtime.entities.model_entities import ModelFeature

from core.entities.knowledge_entities import PreviewDetail
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import AttachmentDocument, Document


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
        expected_docs = [Document(page_content="chunk", metadata={})]

        with patch(
            "core.rag.index_processor.processor.paragraph_index_processor.ExtractProcessor.extract"
        ) as mock_extract:
            mock_extract.return_value = expected_docs
            docs = processor.extract(extract_setting, process_rule_mode="hierarchical")

        assert docs == expected_docs
        mock_extract.assert_called_once_with(extract_setting=extract_setting, is_automatic=True)

    def test_transform_validates_process_rule(self, processor: ParagraphIndexProcessor) -> None:
        with pytest.raises(ValueError, match="No process rule found"):
            processor.transform([Document(page_content="text", metadata={})], process_rule=None)

        with pytest.raises(ValueError, match="No rules found in process rule"):
            processor.transform([Document(page_content="text", metadata={})], process_rule={"mode": "custom"})

    def test_transform_validates_segmentation(self, processor: ParagraphIndexProcessor, process_rule: dict) -> None:
        rules_without_segmentation = SimpleNamespace(segmentation=None)

        with patch(
            "core.rag.index_processor.processor.paragraph_index_processor.Rule.model_validate",
            return_value=rules_without_segmentation,
        ):
            with pytest.raises(ValueError, match="No segmentation found in rules"):
                processor.transform(
                    [Document(page_content="text", metadata={})],
                    process_rule={"mode": "custom", "rules": {"enabled": True}},
                )

    def test_transform_builds_split_documents(self, processor: ParagraphIndexProcessor, process_rule: dict) -> None:
        source_document = Document(page_content="source", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"})
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
            documents = processor.transform([source_document], process_rule=process_rule)

        assert len(documents) == 1
        assert documents[0].page_content == "first"
        assert documents[0].attachments is not None
        assert documents[0].metadata["doc_hash"] == "hash"

    def test_transform_automatic_mode_uses_default_rules(self, processor: ParagraphIndexProcessor) -> None:
        splitter = Mock()
        splitter.split_documents.return_value = [Document(page_content="text", metadata={})]

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
            processor.transform([Document(page_content="text", metadata={})], process_rule={"mode": "automatic"})

        assert mock_validate.call_count == 1

    def test_load_creates_vector_and_multimodal_when_high_quality(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        docs = [Document(page_content="chunk", metadata={})]
        multimodal_docs = [AttachmentDocument(page_content="image", metadata={})]

        with (
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls,
        ):
            processor.load(dataset, docs, multimodal_documents=multimodal_docs)
        vector = mock_vector_cls.return_value
        vector.create.assert_called_once_with(docs)
        vector.create_multimodal.assert_called_once_with(multimodal_docs)
        mock_keyword_cls.assert_not_called()

    def test_load_uses_keyword_add_texts_with_keywords_when_economy(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        docs = [Document(page_content="chunk", metadata={})]

        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.load(dataset, docs, keywords_list=["k1", "k2"])

        mock_keyword_cls.return_value.add_texts.assert_called_once_with(docs, keywords_list=["k1", "k2"])

    def test_load_uses_keyword_add_texts_without_keywords_when_economy(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        docs = [Document(page_content="chunk", metadata={})]

        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.load(dataset, docs)

        mock_keyword_cls.return_value.add_texts.assert_called_once_with(docs)

    def test_clean_deletes_summaries_and_vector(self, processor: ParagraphIndexProcessor, dataset: Mock) -> None:
        scalars_result = Mock()
        scalars_result.all.return_value = [SimpleNamespace(id="seg-1")]
        session = Mock()
        session.scalars.return_value = scalars_result

        with (
            patch("core.rag.index_processor.processor.paragraph_index_processor.db.session", session),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(dataset, ["node-1"], delete_summaries=True)

        mock_summary.assert_called_once_with(dataset, ["seg-1"])
        vector.delete_by_ids.assert_called_once_with(["node-1"])

    def test_clean_economy_deletes_summaries_and_keywords(
        self, processor: ParagraphIndexProcessor, dataset: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls,
        ):
            processor.clean(dataset, None, delete_summaries=True)

        mock_summary.assert_called_once_with(dataset, None)
        mock_keyword_cls.return_value.delete.assert_called_once()

    def test_clean_deletes_keywords_by_ids(self, processor: ParagraphIndexProcessor, dataset: Mock) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        with patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls:
            processor.clean(dataset, ["node-2"], with_keywords=True)

        mock_keyword_cls.return_value.delete_by_ids.assert_called_once_with(["node-2"])

    def test_retrieve_filters_by_threshold(self, processor: ParagraphIndexProcessor, dataset: Mock) -> None:
        accepted = SimpleNamespace(page_content="keep", metadata={"source": "a"}, score=0.9)
        rejected = SimpleNamespace(page_content="drop", metadata={"source": "b"}, score=0.1)

        with patch(
            "core.rag.index_processor.processor.paragraph_index_processor.RetrievalService.retrieve"
        ) as mock_retrieve:
            mock_retrieve.return_value = [accepted, rejected]
            reranking_model = {"reranking_provider_name": "", "reranking_model_name": ""}
            docs = processor.retrieve("semantic_search", "query", dataset, 5, 0.5, reranking_model)

        assert len(docs) == 1
        assert docs[0].metadata["score"] == 0.9

    def test_index_list_chunks_high_quality(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
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
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector") as mock_vector_cls,
        ):
            processor.index(dataset, dataset_document, ["chunk-1", "chunk-2"])

        mock_store_cls.return_value.add_documents.assert_called_once()
        mock_vector_cls.return_value.create.assert_called_once()
        mock_vector_cls.return_value.create_multimodal.assert_called_once()

    def test_index_list_chunks_economy(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.helper.generate_text_hash",
                return_value="hash",
            ),
            patch.object(processor, "_get_content_files", return_value=[]),
            patch("core.rag.index_processor.processor.paragraph_index_processor.DatasetDocumentStore"),
            patch("core.rag.index_processor.processor.paragraph_index_processor.Keyword") as mock_keyword_cls,
        ):
            processor.index(dataset, dataset_document, ["chunk-3"])

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
            ),
            patch.object(
                processor, "_get_content_files", return_value=[AttachmentDocument(page_content="img", metadata={})]
            ) as mock_files,
            patch("core.rag.index_processor.processor.paragraph_index_processor.DatasetDocumentStore"),
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector"),
        ):
            processor.index(dataset, dataset_document, {"general_chunks": []})

        assert mock_files.call_count == 1

    def test_index_multimodal_structure_requires_valid_account(
        self, processor: ParagraphIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        structure = SimpleNamespace(general_chunks=[SimpleNamespace(content="content", files=None)])

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
                processor.index(dataset, dataset_document, {"general_chunks": []})

    def test_format_preview_validates_chunk_shape(self, processor: ParagraphIndexProcessor) -> None:
        preview = processor.format_preview(["chunk-1", "chunk-2"])
        assert preview["chunk_structure"] == "text_model"
        assert preview["total_segments"] == 2

        with pytest.raises(ValueError, match="Chunks is not a list"):
            processor.format_preview({"not": "a-list"})

    def test_generate_summary_preview_success_and_failure(self, processor: ParagraphIndexProcessor) -> None:
        preview_items = [PreviewDetail(content="chunk-1"), PreviewDetail(content="chunk-2")]

        with patch.object(processor, "generate_summary", return_value=("summary", LLMUsage.empty_usage())):
            result = processor.generate_summary_preview(
                "tenant-1", preview_items, {"enable": True}, doc_language="English"
            )
        assert all(item.summary == "summary" for item in result)

        with patch.object(processor, "generate_summary", side_effect=RuntimeError("summary failed")):
            with pytest.raises(ValueError, match="Failed to generate summaries"):
                processor.generate_summary_preview("tenant-1", [PreviewDetail(content="chunk-1")], {"enable": True})

    def test_generate_summary_preview_fallback_without_flask_context(self, processor: ParagraphIndexProcessor) -> None:
        preview_items = [PreviewDetail(content="chunk-1")]
        fake_current_app = SimpleNamespace(_get_current_object=Mock(side_effect=RuntimeError("no app")))

        with (
            patch("flask.current_app", fake_current_app),
            patch.object(processor, "generate_summary", return_value=("summary", LLMUsage.empty_usage())),
        ):
            result = processor.generate_summary_preview("tenant-1", preview_items, {"enable": True})

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
                processor.generate_summary_preview("tenant-1", preview_items, {"enable": True})

        future.cancel.assert_called_once()

    def test_generate_summary_validates_input(self) -> None:
        with pytest.raises(ValueError, match="must be enabled"):
            ParagraphIndexProcessor.generate_summary("tenant-1", "text", {"enable": False})

        with pytest.raises(ValueError, match="model_name and model_provider_name"):
            ParagraphIndexProcessor.generate_summary("tenant-1", "text", {"enable": True})

    def test_generate_summary_text_only_flow(self) -> None:
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
            patch("core.rag.index_processor.processor.paragraph_index_processor.logger") as mock_logger,
        ):
            mock_provider_manager.return_value.get_provider_model_bundle.return_value = Mock()
            summary, usage = ParagraphIndexProcessor.generate_summary(
                "tenant-1",
                "text content",
                {"enable": True, "model_name": "model-a", "model_provider_name": "provider-a"},
                document_language="English",
            )

        assert summary == "text summary"
        assert isinstance(usage, LLMUsage)
        mock_logger.warning.assert_called_with("Failed to deduct quota for summary generation: %s", "quota")

    def test_generate_summary_handles_vision_and_image_conversion(self) -> None:
        model_instance = Mock()
        model_instance.credentials = {"k": "v"}
        model_instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(
            features=[ModelFeature.VISION]
        )
        model_instance.invoke_llm.return_value = self._llm_result("vision summary")
        image_file = SimpleNamespace()
        image_content = ImagePromptMessageContent(format="url", mime_type="image/png", url="http://example.com/a.png")

        with (
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.create_plugin_provider_manager"
            ) as mock_provider_manager,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ModelInstance",
                return_value=model_instance,
            ),
            patch.object(
                ParagraphIndexProcessor, "_extract_images_from_segment_attachments", return_value=[image_file]
            ),
            patch.object(ParagraphIndexProcessor, "_extract_images_from_text", return_value=[]) as mock_extract_text,
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.file_manager.to_prompt_message_content",
                return_value=image_content,
            ),
            patch("core.rag.index_processor.processor.paragraph_index_processor.deduct_llm_quota"),
        ):
            mock_provider_manager.return_value.get_provider_model_bundle.return_value = Mock()
            summary, _ = ParagraphIndexProcessor.generate_summary(
                "tenant-1",
                "text content",
                {"enable": True, "model_name": "model-a", "model_provider_name": "provider-a"},
                segment_id="seg-1",
            )

        assert summary == "vision summary"
        mock_extract_text.assert_not_called()

    def test_generate_summary_fallbacks_for_prompt_and_result_types(self) -> None:
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
            patch("core.rag.index_processor.processor.paragraph_index_processor.logger") as mock_logger,
        ):
            mock_provider_manager.return_value.get_provider_model_bundle.return_value = Mock()
            with pytest.raises(ValueError, match="Expected LLMResult"):
                ParagraphIndexProcessor.generate_summary(
                    "tenant-1",
                    "text content",
                    {"enable": True, "model_name": "model-a", "model_provider_name": "provider-a"},
                )

        mock_logger.warning.assert_called_with(
            "Failed to convert image file to prompt message content: %s", "bad image"
        )

    def test_extract_images_from_text_handles_patterns_and_build_errors(self) -> None:
        text = (
            "![img](/files/11111111-1111-1111-1111-111111111111/image-preview) "
            "![img2](/files/22222222-2222-2222-2222-222222222222/file-preview) "
            "![tool](/files/tools/33333333-3333-3333-3333-333333333333.png)"
        )
        image_upload = SimpleNamespace(
            id="11111111-1111-1111-1111-111111111111",
            tenant_id="tenant-1",
            name="image.png",
            mime_type="image/png",
            extension="png",
            source_url="",
            size=1,
            key="key",
        )
        non_image_upload = SimpleNamespace(
            id="22222222-2222-2222-2222-222222222222",
            tenant_id="tenant-1",
            name="file.txt",
            mime_type="text/plain",
            extension="txt",
            source_url="",
            size=1,
            key="key",
        )
        scalars_result = Mock()
        scalars_result.all.return_value = [image_upload, non_image_upload]
        session = Mock()
        session.scalars.return_value = scalars_result

        with (
            patch("core.rag.index_processor.processor.paragraph_index_processor.db.session", session),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.build_from_mapping",
                return_value=SimpleNamespace(id="file-1"),
            ) as mock_builder,
            patch("core.rag.index_processor.processor.paragraph_index_processor.logger") as mock_logger,
        ):
            files = ParagraphIndexProcessor._extract_images_from_text("tenant-1", text)

        assert len(files) == 1
        assert mock_builder.call_count == 1
        mock_logger.warning.assert_not_called()

    def test_extract_images_from_text_returns_empty_when_no_matches(self) -> None:
        assert ParagraphIndexProcessor._extract_images_from_text("tenant-1", "no images here") == []

    def test_extract_images_from_text_logs_when_build_fails(self) -> None:
        text = "![img](/files/11111111-1111-1111-1111-111111111111/image-preview)"
        image_upload = SimpleNamespace(
            id="11111111-1111-1111-1111-111111111111",
            tenant_id="tenant-1",
            name="image.png",
            mime_type="image/png",
            extension="png",
            source_url="",
            size=1,
            key="key",
        )
        scalars_result = Mock()
        scalars_result.all.return_value = [image_upload]
        session = Mock()
        session.scalars.return_value = scalars_result

        with (
            patch("core.rag.index_processor.processor.paragraph_index_processor.db.session", session),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.build_from_mapping",
                side_effect=RuntimeError("build failed"),
            ),
            patch("core.rag.index_processor.processor.paragraph_index_processor.logger") as mock_logger,
        ):
            files = ParagraphIndexProcessor._extract_images_from_text("tenant-1", text)

        assert files == []
        mock_logger.warning.assert_called_once()

    def test_extract_images_from_segment_attachments(self) -> None:
        image_upload = SimpleNamespace(
            id="file-1",
            name="image",
            extension="png",
            mime_type="image/png",
            source_url="",
            size=1,
            key="k1",
        )
        bad_upload = SimpleNamespace(
            id="file-2",
            name="broken",
            extension=None,
            mime_type="image/png",
            source_url="",
            size=1,
            key="k2",
        )
        non_image_upload = SimpleNamespace(
            id="file-3",
            name="text",
            extension="txt",
            mime_type="text/plain",
            source_url="",
            size=1,
            key="k3",
        )
        execute_result = Mock()
        execute_result.all.return_value = [(None, image_upload), (None, bad_upload), (None, non_image_upload)]
        session = Mock()
        session.execute.return_value = execute_result

        with (
            patch("core.rag.index_processor.processor.paragraph_index_processor.db.session", session),
            patch("core.rag.index_processor.processor.paragraph_index_processor.logger") as mock_logger,
        ):
            files = ParagraphIndexProcessor._extract_images_from_segment_attachments("tenant-1", "seg-1")

        assert len(files) == 1
        mock_logger.warning.assert_called_once()

    def test_extract_images_from_segment_attachments_empty(self) -> None:
        execute_result = Mock()
        execute_result.all.return_value = []
        session = Mock()
        session.execute.return_value = execute_result

        with patch("core.rag.index_processor.processor.paragraph_index_processor.db.session", session):
            empty_files = ParagraphIndexProcessor._extract_images_from_segment_attachments("tenant-1", "seg-1")

        assert empty_files == []
