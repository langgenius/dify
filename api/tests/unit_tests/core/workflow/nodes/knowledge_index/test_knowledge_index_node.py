import unittest
import uuid
from unittest.mock import MagicMock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.knowledge_index.entities import DocMetadata, KnowledgeIndexNodeData
from core.workflow.nodes.knowledge_index.knowledge_index_node import KnowledgeIndexNode
from core.workflow.runtime import VariablePool
from models.dataset import Dataset, DatasetMetadata, Document
from models.enums import UserFrom


class TestKnowledgeIndexNode(unittest.TestCase):
    def setUp(self):
        self.dataset_id = str(uuid.uuid4())
        self.document_id = str(uuid.uuid4())
        self.mock_dataset = MagicMock(spec=Dataset)
        self.mock_dataset.id = self.dataset_id
        self.mock_dataset.built_in_field_enabled = False

        self.mock_document = MagicMock(spec=Document)
        self.mock_document.id = self.document_id
        self.mock_document.doc_metadata = {}

    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.attributes.flag_modified")
    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session")
    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory")
    def test_run_with_custom_metadata(self, mock_index_processor_factory, mock_db_session, mock_flag_modified):
        # Mock DB queries
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            self.mock_dataset,  # For dataset query
            self.mock_document,  # For document query
        ]

        # Mock Dataset Metadata
        mock_metadata = MagicMock(spec=DatasetMetadata)
        mock_metadata.id = "meta_uuid_1"
        mock_metadata.name = "Category"
        mock_db_session.scalars.return_value.all.return_value = [mock_metadata]
        # Simpler mock for the scalar query - switched to bulk fetch
        mock_db_session.scalar.return_value = "Category"

        # Mock Variable Pool
        pool = MagicMock(spec=VariablePool)

        # Handle the chunk variable
        chunk_var_mock = MagicMock()
        chunk_var_mock.value = {"chunk": "data"}

        def variable_pool_get(selector):
            if selector == ["sys", SystemVariableKey.DATASET_ID]:
                return MagicMock(value=self.dataset_id)
            if selector == ["sys", SystemVariableKey.DOCUMENT_ID]:
                return MagicMock(value=self.document_id)
            if selector == ["sys", SystemVariableKey.BATCH]:
                return MagicMock(value="test-batch")
            if selector == ["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID]:
                return None
            if selector == ["Start", "category"]:
                var = MagicMock()
                var.to_object.return_value = "Financial"
                return var
            if selector == ["sys", SystemVariableKey.INVOKE_FROM]:
                return None
            if selector == ["sys", "chunks"]:
                return chunk_var_mock
            return None

        pool.get.side_effect = variable_pool_get

        # Node Configuration
        node_data = KnowledgeIndexNodeData(
            id="node1",
            title="Knowledge",
            chunk_structure="chunk",
            index_chunk_variable_selector=["sys", "chunks"],
            doc_metadata=[DocMetadata(metadata_id="meta_uuid_1", value=["Start", "category"])],
        )

        # Initialize Node
        graph_init_params = MagicMock()
        graph_init_params.user_from = UserFrom.ACCOUNT
        graph_init_params.invoke_from = InvokeFrom.WEB_APP

        config = {"id": "node1", "data": node_data.model_dump()}

        node = KnowledgeIndexNode(
            id="node1",
            graph_init_params=graph_init_params,
            graph_runtime_state=MagicMock(variable_pool=pool),
            config=config,
        )

        # Execute
        result = node._run()

        # Verify metadata was set on document
        assert self.mock_document.doc_metadata["Category"] == "Financial"
        # Verify flag_modified was called for the doc_metadata field
        mock_flag_modified.assert_called_with(self.mock_document, "doc_metadata")
        # Verify commit was called
        mock_db_session.commit.assert_called()

    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session")
    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory")
    def test_run_with_missing_metadata_variable_fails_before_indexing(
        self, mock_index_processor_factory, mock_db_session
    ):
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            self.mock_dataset,
            self.mock_document,
        ]

        mock_metadata = MagicMock(spec=DatasetMetadata)
        mock_metadata.id = "meta_uuid_1"
        mock_metadata.name = "Category"
        mock_db_session.scalars.return_value.all.return_value = [mock_metadata]

        pool = MagicMock(spec=VariablePool)
        chunk_var_mock = MagicMock()
        chunk_var_mock.value = {"chunk": "data"}

        def variable_pool_get(selector):
            if selector == ["sys", SystemVariableKey.DATASET_ID]:
                return MagicMock(value=self.dataset_id)
            if selector == ["sys", SystemVariableKey.DOCUMENT_ID]:
                return MagicMock(value=self.document_id)
            if selector == ["sys", SystemVariableKey.BATCH]:
                return MagicMock(value="test-batch")
            if selector == ["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID]:
                return None
            if selector == ["Start", "missing"]:
                return None
            if selector == ["sys", SystemVariableKey.INVOKE_FROM]:
                return None
            if selector == ["sys", "chunks"]:
                return chunk_var_mock
            return None

        pool.get.side_effect = variable_pool_get

        node_data = KnowledgeIndexNodeData(
            id="node1",
            title="Knowledge",
            chunk_structure="chunk",
            index_chunk_variable_selector=["sys", "chunks"],
            doc_metadata=[DocMetadata(metadata_id="meta_uuid_1", value=["Start", "missing"])],
        )

        graph_init_params = MagicMock()
        graph_init_params.user_from = UserFrom.ACCOUNT
        graph_init_params.invoke_from = InvokeFrom.WEB_APP

        config = {"id": "node1", "data": node_data.model_dump()}
        node = KnowledgeIndexNode(
            id="node1",
            graph_init_params=graph_init_params,
            graph_runtime_state=MagicMock(variable_pool=pool),
            config=config,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error
        assert "Variable 'Start.missing' not found" in result.error
        mock_index_processor_factory.return_value.init_index_processor.assert_not_called()
