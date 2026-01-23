import unittest
import uuid
from unittest.mock import MagicMock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
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

    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.db.session")
    @patch("core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessorFactory")
    def test_run_with_custom_metadata(self, mock_index_processor_factory, mock_db_session):
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

        # System variables
        pool.get.side_effect = lambda selector: {
            ("sys", SystemVariableKey.DATASET_ID): MagicMock(value=self.dataset_id),
            ("sys", SystemVariableKey.DOCUMENT_ID): MagicMock(value=self.document_id),
            ("sys", SystemVariableKey.INVOKE_FROM): None,
            ("Start", "category"): MagicMock(to_object=lambda: "Financial"),
            # handle list as key? get takes list
            frozenset(["Start", "category"]): MagicMock(to_object=lambda: "Financial"),
        }.get(tuple(selector) if isinstance(selector, list) else selector)

        # Handle the chunk variable specifically first
        chunk_var_mock = MagicMock()
        chunk_var_mock.value = {"chunk": "data"}

        # Override side_effect to handle list lookups correctly
        def variable_pool_get(selector):
            if selector == ["sys", SystemVariableKey.DATASET_ID]:
                return MagicMock(value=self.dataset_id)
            if selector == ["sys", SystemVariableKey.DOCUMENT_ID]:
                return MagicMock(value=self.document_id)
            if selector == ["Start", "category"]:
                var = MagicMock()
                var.to_object.return_value = "Financial"
                return var
            if selector == ["sys", SystemVariableKey.INVOKE_FROM]:
                return None
            if selector == ["sys", "chunks"]:  # whatever index_chunk_variable_selector is
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

        # Mock _invoke_knowledge_index to avoid calling specific index logic
        node._invoke_knowledge_index = MagicMock()

        # Execute
        result = node._run()

        # Verify
        assert self.mock_document.doc_metadata["Category"] == "Financial"
        mock_db_session.add.assert_called_with(self.mock_document)
        mock_db_session.commit.assert_called()
