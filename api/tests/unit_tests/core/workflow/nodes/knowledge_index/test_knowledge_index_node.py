from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.knowledge_index.knowledge_index_node import (
    KnowledgeIndexNode,
    KnowledgeIndexNodeError,
)
from models.enums import UserFrom


@pytest.fixture
def mock_dataset():
    return SimpleNamespace(
        id="ds1",
        name="dataset",
        indexing_technique="high_quality",
        summary_index_setting={"enable": True},
        chunk_structure="paragraph",
        tenant_id="tenant1",
    )


@pytest.fixture
def mock_document():
    return SimpleNamespace(
        id="doc1",
        name="doc",
        created_at=datetime.utcnow(),
        indexing_latency=None,
        indexing_status=None,
        completed_at=None,
        word_count=100,
        need_summary=False,
        doc_form="normal",
    )


@pytest.fixture
def mock_variable_pool():
    pool = MagicMock()
    values = {}

    def getter(key):
        return values.get(tuple(key)) if isinstance(key, list) else values.get(key)

    pool.get.side_effect = getter
    pool._values = values
    return pool


@pytest.fixture
def node(mock_variable_pool):
    graph_runtime_state = MagicMock()
    graph_runtime_state.variable_pool = mock_variable_pool

    graph_init_params = MagicMock()
    graph_init_params.user_from = UserFrom.ACCOUNT
    graph_init_params.invoke_from = InvokeFrom.SERVICE_API
    graph_init_params.tenant_id = "tenant1"
    graph_init_params.app_id = "app1"
    graph_init_params.workflow_id = "wf1"
    graph_init_params.graph_config = {}
    graph_init_params.user_id = "user1"
    graph_init_params.call_depth = 0

    config = {
        "id": "node1",
        "data": {
            "title": "Test Node",
            "chunk_structure": "paragraph",
            "index_chunk_variable_selector": ["chunks"],
            "indexing_technique": None,
            "summary_index_setting": None,
        },
    }

    return KnowledgeIndexNode(
        id="node1",
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )


class TestRun:
    def test_missing_dataset_id(self, node):
        with pytest.raises(KnowledgeIndexNodeError):
            node._run()

    def test_dataset_not_found(self, node, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="x")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = None
            with pytest.raises(KnowledgeIndexNodeError):
                node._run()

    def test_empty_chunks(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value=None)

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset
            result = node._run()
            assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_production_success(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value={"a": 1})

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset

            with patch.object(node, "_invoke_knowledge_index") as invoke:
                invoke.return_value = {"ok": True}
                result = node._run()
                assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED


class TestInvokeKnowledgeIndex:
    def test_missing_document_id(self, node, mock_dataset, mock_variable_pool):
        with pytest.raises(KnowledgeIndexNodeError):
            node._invoke_knowledge_index(mock_dataset, node.node_data, {}, mock_variable_pool)

    def test_missing_batch(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")
        with pytest.raises(KnowledgeIndexNodeError):
            node._invoke_knowledge_index(mock_dataset, node.node_data, {}, mock_variable_pool)

    def test_document_not_found(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")
        mock_variable_pool._values[("sys", SystemVariableKey.BATCH)] = SimpleNamespace(value="b1")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = None
            with pytest.raises(KnowledgeIndexNodeError):
                node._invoke_knowledge_index(mock_dataset, node.node_data, {}, mock_variable_pool)


class TestHandleSummaryIndex:
    def test_skip_non_high_quality(self, node, mock_document, mock_variable_pool):
        dataset = SimpleNamespace(indexing_technique="low", summary_index_setting={"enable": True})
        node._handle_summary_index_generation(dataset, mock_document, mock_variable_pool)

    def test_skip_summary_disabled(self, node, mock_document, mock_variable_pool):
        dataset = SimpleNamespace(indexing_technique="high_quality", summary_index_setting={"enable": False})
        node._handle_summary_index_generation(dataset, mock_document, mock_variable_pool)

    def test_skip_qa_model(self, node, mock_variable_pool):
        dataset = SimpleNamespace(indexing_technique="high_quality", summary_index_setting={"enable": True})
        document = SimpleNamespace(doc_form="qa_model")
        node._handle_summary_index_generation(dataset, document, mock_variable_pool)

    def test_production_queue_task(self, node, mock_dataset, mock_document, mock_variable_pool):
        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.generate_summary_index_task.delay") as d:
            node._handle_summary_index_generation(mock_dataset, mock_document, mock_variable_pool)
            d.assert_called_once()


class TestPreviewWithSummaries:
    def test_skip_if_not_high_quality(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": []}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            result = node._get_preview_output_with_summaries(
                "paragraph",
                {"a": 1},
                mock_dataset,
                indexing_technique="low",
                summary_index_setting={"enable": True},
            )
            assert isinstance(result, dict)

    def test_summary_generation_success(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": [{"content": "text"}]}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            with patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ParagraphIndexProcessor.generate_summary",
                return_value=("summary", None),
            ):
                result = node._get_preview_output_with_summaries(
                    "paragraph",
                    {"a": 1},
                    mock_dataset,
                    indexing_technique="high_quality",
                    summary_index_setting={"enable": True},
                )
                assert result["preview"][0]["summary"] == "summary"


class TestPreviewOutput:
    def test_basic_preview(self, node):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": []}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor
            result = node._get_preview_output("paragraph", {})
            assert result == {"preview": []}


class TestMisc:
    def test_version(self):
        assert KnowledgeIndexNode.version() == "1"

    def test_streaming_template(self, node):
        template = node.get_streaming_template()
        assert template.segments == []


class TestRunRemaining:
    def test_preview_success(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value={"a": 1})
        mock_variable_pool._values[("sys", SystemVariableKey.INVOKE_FROM)] = SimpleNamespace(
            value=InvokeFrom.DEBUGGER.value
        )

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset
            with patch.object(node, "_get_preview_output_with_summaries") as preview:
                preview.return_value = {"preview": []}
                result = node._run()
                assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    def test_preview_failure_error(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value={"a": 1})
        mock_variable_pool._values[("sys", SystemVariableKey.INVOKE_FROM)] = SimpleNamespace(
            value=InvokeFrom.DEBUGGER.value
        )

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset
            with patch.object(
                node,
                "_get_preview_output_with_summaries",
                side_effect=KnowledgeIndexNodeError("boom"),
            ):
                result = node._run()
                assert result.status == WorkflowNodeExecutionStatus.FAILED
                assert result.error_type == "KnowledgeIndexNodeError"

    def test_invoke_knowledge_error(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value={"a": 1})

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset

            with patch.object(
                node,
                "_invoke_knowledge_index",
                side_effect=KnowledgeIndexNodeError("fail"),
            ):
                result = node._run()
                assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_invoke_generic_exception(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value={"a": 1})

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset

            with patch.object(node, "_invoke_knowledge_index", side_effect=Exception("x")):
                result = node._run()
                assert result.status == WorkflowNodeExecutionStatus.FAILED
                assert result.error_type == "Exception"


class TestInvokeKnowledgeIndexSuccess:
    def test_success_flow(self, node, mock_dataset, mock_document, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")
        mock_variable_pool._values[("sys", SystemVariableKey.BATCH)] = SimpleNamespace(value="b1")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.first.return_value = mock_document
            session.query.return_value.where.return_value.scalar.return_value = 10
            session.query.return_value.where.return_value.update.return_value = None

            with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
                factory.return_value.init_index_processor.return_value = MagicMock()

                with patch.object(node, "_handle_summary_index_generation"):
                    result = node._invoke_knowledge_index(mock_dataset, node.node_data, {"a": 1}, mock_variable_pool)
                    assert result["display_status"] == "completed"

    def test_original_document_cleanup(self, node, mock_dataset, mock_document, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")
        mock_variable_pool._values[("sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID)] = SimpleNamespace(value="orig")
        mock_variable_pool._values[("sys", SystemVariableKey.BATCH)] = SimpleNamespace(value="b1")

        segment = SimpleNamespace(index_node_id="idx1")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.first.return_value = mock_document
            session.scalars.return_value.all.return_value = [segment]
            session.query.return_value.where.return_value.scalar.return_value = 10

            fake_processor = MagicMock()

            with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
                factory.return_value.init_index_processor.return_value = fake_processor

                with patch.object(node, "_handle_summary_index_generation"):
                    node._invoke_knowledge_index(mock_dataset, node.node_data, {"a": 1}, mock_variable_pool)
                    fake_processor.clean.assert_called_once()


class TestHandleSummaryPreview:
    def test_preview_segments_generate(self, node, mock_dataset, mock_variable_pool):
        mock_document = SimpleNamespace(id="doc1", doc_form="normal")

        mock_variable_pool._values[("sys", SystemVariableKey.INVOKE_FROM)] = SimpleNamespace(
            value=InvokeFrom.DEBUGGER.value
        )

        segment = SimpleNamespace(id="seg1")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.all.return_value = [segment]
            session.query.return_value.filter_by.return_value.first.return_value = None

            with patch(
                "core.workflow.nodes.knowledge_index.knowledge_index_node.SummaryIndexService.generate_and_vectorize_summary"
            ):
                node._handle_summary_index_generation(mock_dataset, mock_document, mock_variable_pool)

    def test_preview_generation_exception(self, node, mock_dataset, mock_variable_pool):
        mock_document = SimpleNamespace(id="doc1", doc_form="normal")

        mock_variable_pool._values[("sys", SystemVariableKey.INVOKE_FROM)] = SimpleNamespace(
            value=InvokeFrom.DEBUGGER.value
        )

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.side_effect = Exception("db error")
            node._handle_summary_index_generation(mock_dataset, mock_document, mock_variable_pool)


class TestPreviewWithSummariesEdge:
    def test_timeout_error(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": [{"content": "text"}]}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            mock_future = MagicMock()
            with patch(
                "core.workflow.nodes.knowledge_index.knowledge_index_node.concurrent.futures.wait",
                return_value=(set(), {mock_future}),
            ):
                with pytest.raises(KnowledgeIndexNodeError):
                    node._get_preview_output_with_summaries(
                        "paragraph",
                        {"a": 1},
                        mock_dataset,
                        indexing_technique="high_quality",
                        summary_index_setting={"enable": True},
                    )

    def test_future_exception(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": [{"content": "text"}]}

        mock_future = MagicMock()
        mock_future.result.side_effect = Exception("fail")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            with patch(
                "core.workflow.nodes.knowledge_index.knowledge_index_node.concurrent.futures.wait",
                return_value=({mock_future}, set()),
            ):
                with pytest.raises(KnowledgeIndexNodeError):
                    node._get_preview_output_with_summaries(
                        "paragraph",
                        {"a": 1},
                        mock_dataset,
                        indexing_technique="high_quality",
                        summary_index_setting={"enable": True},
                    )


class TestPreviewEnrichment:
    def test_enrich_preview_with_existing_summaries(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")

        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": [{"content": "hello"}]}

        segment = SimpleNamespace(id="seg1", content="hello")
        summary = SimpleNamespace(chunk_id="seg1", summary_content="summary")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
                session.query.return_value.filter_by.return_value.first.return_value = SimpleNamespace(id="doc1")
                session.query.return_value.filter_by.return_value.all.return_value = [summary]
                session.query.return_value.filter_by.return_value.first.return_value = segment

                result = node._get_preview_output(
                    "paragraph",
                    {},
                    dataset=mock_dataset,
                    variable_pool=mock_variable_pool,
                )

                assert result["preview"][0]["summary"] == "summary"


class TestRunInvokeFromAbsent:
    def test_invoke_from_not_present_defaults_production(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DATASET_ID)] = SimpleNamespace(value="ds1")
        mock_variable_pool._values[("chunks",)] = SimpleNamespace(value={"a": 1})

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session.query") as q:
            q.return_value.filter_by.return_value.first.return_value = mock_dataset

            with patch.object(node, "_invoke_knowledge_index") as invoke:
                invoke.return_value = {"ok": True}
                result = node._run()
                assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED


class TestInvokeNeedSummaryBranches:
    def test_need_summary_none_setting(self, node, mock_document, mock_variable_pool):
        dataset = SimpleNamespace(
            id="ds1",
            name="d",
            summary_index_setting=None,
            indexing_technique="high_quality",
            chunk_structure="paragraph",
            tenant_id="tenant1",
        )

        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")
        mock_variable_pool._values[("sys", SystemVariableKey.BATCH)] = SimpleNamespace(value="b1")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.first.return_value = mock_document
            session.query.return_value.where.return_value.scalar.return_value = 0

            with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
                factory.return_value.init_index_processor.return_value = MagicMock()

                with patch.object(node, "_handle_summary_index_generation"):
                    node._invoke_knowledge_index(dataset, node.node_data, {}, mock_variable_pool)
                    assert mock_document.need_summary is False

    def test_original_document_no_segments(self, node, mock_document, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")
        mock_variable_pool._values[("sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID)] = SimpleNamespace(value="orig")
        mock_variable_pool._values[("sys", SystemVariableKey.BATCH)] = SimpleNamespace(value="b1")

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.first.return_value = mock_document
            session.scalars.return_value.all.return_value = []
            session.query.return_value.where.return_value.scalar.return_value = 0

            with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
                factory.return_value.init_index_processor.return_value = MagicMock()

                with patch.object(node, "_handle_summary_index_generation"):
                    node._invoke_knowledge_index(mock_dataset, node.node_data, {}, mock_variable_pool)


class TestHandleSummaryMoreBranches:
    def test_preview_no_segments(self, node, mock_dataset, mock_variable_pool):
        mock_document = SimpleNamespace(id="doc1", doc_form="normal")

        mock_variable_pool._values[("sys", SystemVariableKey.INVOKE_FROM)] = SimpleNamespace(
            value=InvokeFrom.DEBUGGER.value
        )

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.all.return_value = []
            node._handle_summary_index_generation(mock_dataset, mock_document, mock_variable_pool)

    def test_preview_all_segments_already_have_summary(self, node, mock_dataset, mock_variable_pool):
        mock_document = SimpleNamespace(id="doc1", doc_form="normal")
        segment = SimpleNamespace(id="seg1")

        mock_variable_pool._values[("sys", SystemVariableKey.INVOKE_FROM)] = SimpleNamespace(
            value=InvokeFrom.DEBUGGER.value
        )

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
            session.query.return_value.filter_by.return_value.all.return_value = [segment]
            session.query.return_value.filter_by.return_value.first.return_value = SimpleNamespace()

            node._handle_summary_index_generation(mock_dataset, mock_document, mock_variable_pool)

    def test_production_task_queue_exception(self, node, mock_dataset, mock_document):
        mock_variable_pool = MagicMock()

        with patch(
            "core.workflow.nodes.knowledge_index.knowledge_index_node.generate_summary_index_task.delay",
            side_effect=Exception("fail"),
        ):
            node._handle_summary_index_generation(mock_dataset, mock_document, mock_variable_pool)


class TestPreviewWithSummariesRareBranches:
    def test_no_preview_key(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            result = node._get_preview_output_with_summaries(
                "paragraph",
                {},
                mock_dataset,
                indexing_technique="high_quality",
                summary_index_setting={"enable": True},
            )
            assert result == {}

    def test_preview_not_list(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": "not_list"}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            result = node._get_preview_output_with_summaries(
                "paragraph",
                {},
                mock_dataset,
                indexing_technique="high_quality",
                summary_index_setting={"enable": True},
            )
            assert result["preview"] == "not_list"

    def test_generate_summary_returns_none(self, node, mock_dataset):
        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": [{"content": "text"}]}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            with patch(
                "core.rag.index_processor.processor.paragraph_index_processor.ParagraphIndexProcessor.generate_summary",
                return_value=(None, None),
            ):
                result = node._get_preview_output_with_summaries(
                    "paragraph",
                    {},
                    mock_dataset,
                    indexing_technique="high_quality",
                    summary_index_setting={"enable": True},
                )
                assert "summary" not in result["preview"][0]


class TestPreviewOutputExtra:
    def test_dataset_no_document_found(self, node, mock_dataset, mock_variable_pool):
        mock_variable_pool._values[("sys", SystemVariableKey.DOCUMENT_ID)] = SimpleNamespace(value="doc1")

        fake_processor = MagicMock()
        fake_processor.format_preview.return_value = {"preview": []}

        with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory") as factory:
            factory.return_value.init_index_processor.return_value = fake_processor

            with patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session") as session:
                session.query.return_value.filter_by.return_value.first.return_value = None

                result = node._get_preview_output(
                    "paragraph",
                    {},
                    dataset=mock_dataset,
                    variable_pool=mock_variable_pool,
                )
                assert result == {"preview": []}
