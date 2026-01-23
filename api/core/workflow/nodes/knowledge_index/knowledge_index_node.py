import datetime
import logging
import time
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import attributes

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType, SystemVariableKey
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document, DocumentSegment

from .entities import KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

logger = logging.getLogger(__name__)

# Constant for built-in metadata identifier
BUILT_IN_METADATA_ID = "built-in"

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class KnowledgeIndexNode(Node[KnowledgeIndexNodeData]):
    node_type = NodeType.KNOWLEDGE_INDEX
    execution_type = NodeExecutionType.RESPONSE

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool
        dataset_id = variable_pool.get(["sys", SystemVariableKey.DATASET_ID])
        if not dataset_id:
            raise KnowledgeIndexNodeError("Dataset ID is required.")
        dataset = db.session.query(Dataset).filter_by(id=dataset_id.value).first()
        if not dataset:
            raise KnowledgeIndexNodeError(f"Dataset {dataset_id.value} not found.")

        # extract variables
        variable = variable_pool.get(node_data.index_chunk_variable_selector)
        if not variable:
            raise KnowledgeIndexNodeError("Index chunk variable is required.")
        invoke_from = variable_pool.get(["sys", SystemVariableKey.INVOKE_FROM])
        if invoke_from:
            is_preview = invoke_from.value == InvokeFrom.DEBUGGER
        else:
            is_preview = False
        chunks = variable.value
        variables = {"chunks": chunks}
        if not chunks:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Chunks is required."
            )

        # index knowledge
        try:
            if is_preview:
                outputs = self._get_preview_output(node_data.chunk_structure, chunks)
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=variables,
                    outputs=outputs,
                )
            results = self._invoke_knowledge_index(
                dataset=dataset, node_data=node_data, chunks=chunks, variable_pool=variable_pool
            )
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs=results)

        except KnowledgeIndexNodeError as e:
            logger.warning("Error when running knowledge index node")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )
        # Temporary handle all exceptions from DatasetRetrieval class here.
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )

    def _invoke_knowledge_index(
        self,
        dataset: Dataset,
        node_data: KnowledgeIndexNodeData,
        chunks: Mapping[str, Any],
        variable_pool: VariablePool,
    ) -> Any:
        document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
        if not document_id:
            raise KnowledgeIndexNodeError("Document ID is required.")
        original_document_id = variable_pool.get(["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID])

        batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
        if not batch:
            raise KnowledgeIndexNodeError("Batch is required.")
        document = db.session.query(Document).filter_by(id=document_id.value).first()
        if not document:
            raise KnowledgeIndexNodeError(f"Document {document_id.value} not found.")
        doc_id_value = document.id
        ds_id_value = dataset.id
        dataset_name_value = dataset.name
        document_name_value = document.name
        created_at_value = document.created_at
        # chunk nodes by chunk size
        indexing_start_at = time.perf_counter()
        index_processor = IndexProcessorFactory(dataset.chunk_structure).init_index_processor()
        if original_document_id:
            segments = db.session.scalars(
                select(DocumentSegment).where(DocumentSegment.document_id == original_document_id.value)
            ).all()
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]

                # delete from vector index
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in segments:
                    db.session.delete(segment)
                db.session.commit()
        index_processor.index(dataset, document, chunks)
        indexing_end_at = time.perf_counter()
        document.indexing_latency = indexing_end_at - indexing_start_at
        # update document status
        document.indexing_status = "completed"
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        document.word_count = (
            db.session.query(func.sum(DocumentSegment.word_count))
            .where(
                DocumentSegment.document_id == doc_id_value,
                DocumentSegment.dataset_id == ds_id_value,
            )
            .scalar()
        )
        db.session.add(document)
        # update document segment status
        db.session.query(DocumentSegment).where(
            DocumentSegment.document_id == doc_id_value,
            DocumentSegment.dataset_id == ds_id_value,
        ).update(
            {
                DocumentSegment.status: "completed",
                DocumentSegment.enabled: True,
                DocumentSegment.completed_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            }
        )

        # Process doc_metadata before commit to ensure it's saved with the same document object
        if node_data.doc_metadata:
            try:
                # Fetch metadata definitions for name mapping
                metadata_name_map: dict[str, str] = {}
                dataset_metadatas = db.session.scalars(
                    select(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset.id)
                ).all()
                for md in dataset_metadatas:
                    metadata_name_map[md.id] = md.name

                # Collect valid metadata IDs (excluding built-in)
                valid_metadata_ids = [
                    item.metadata_id
                    for item in node_data.doc_metadata
                    if item.metadata_id != BUILT_IN_METADATA_ID and item.metadata_id in metadata_name_map
                ]

                # Batch fetch existing bindings to avoid N+1 query
                existing_binding_ids: set[str] = set()
                if valid_metadata_ids:
                    existing_bindings = db.session.scalars(
                        select(DatasetMetadataBinding.metadata_id).where(
                            DatasetMetadataBinding.dataset_id == dataset.id,
                            DatasetMetadataBinding.document_id == doc_id_value,
                            DatasetMetadataBinding.metadata_id.in_(valid_metadata_ids),
                        )
                    ).all()
                    existing_binding_ids = set(existing_bindings)

                doc_metadata_dict = document.doc_metadata or {}

                for item in node_data.doc_metadata:
                    # Skip built-in fields
                    if item.metadata_id == BUILT_IN_METADATA_ID:
                        continue

                    # Resolve Name
                    md_name = metadata_name_map.get(item.metadata_id)
                    if not md_name:
                        logger.warning(
                            "[KnowledgeIndexNode] metadata_id %s not found, skipping", item.metadata_id
                        )
                        continue

                    # Resolve Value
                    value = item.value
                    if isinstance(value, list):
                        var_obj = variable_pool.get(value)
                        if var_obj:
                            value = var_obj.to_object()
                        else:
                            # Variable not found - raise error to notify user of configuration issue
                            variable_path = ".".join(value)
                            raise KnowledgeIndexNodeError(
                                f"Variable '{variable_path}' not found for metadata '{md_name}'. "
                                f"Please check your variable configuration."
                            )

                    if value is not None:
                        doc_metadata_dict[md_name] = value

                    # Create DatasetMetadataBinding if not exists
                    if item.metadata_id not in existing_binding_ids:
                        binding = DatasetMetadataBinding(
                            tenant_id=dataset.tenant_id,
                            dataset_id=dataset.id,
                            metadata_id=item.metadata_id,
                            document_id=doc_id_value,
                            created_by=self.user_id,
                        )
                        db.session.add(binding)
                        existing_binding_ids.add(item.metadata_id)  # Prevent duplicate in same batch

                document.doc_metadata = doc_metadata_dict
                # Force SQLAlchemy to recognize the change to the JSON field
                attributes.flag_modified(document, "doc_metadata")

            except Exception as e:
                logger.exception("[KnowledgeIndexNode] Failed to process doc_metadata")
                raise KnowledgeIndexNodeError(f"Failed to process document metadata: {e}") from e

        db.session.commit()

        return {
            "dataset_id": ds_id_value,
            "dataset_name": dataset_name_value,
            "batch": batch.value,
            "document_id": doc_id_value,
            "document_name": document_name_value,
            "created_at": created_at_value.timestamp(),
            "display_status": "completed",
        }

    def _get_preview_output(self, chunk_structure: str, chunks: Any) -> Mapping[str, Any]:
        index_processor = IndexProcessorFactory(chunk_structure).init_index_processor()
        return index_processor.format_preview(chunks)

    @classmethod
    def version(cls) -> str:
        return "1"

    def get_streaming_template(self) -> Template:
        """
        Get the template for streaming.

        Returns:
            Template instance for this knowledge index node
        """
        return Template(segments=[])

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, *, graph_config: Mapping[str, Any], node_id: str, node_data: Mapping[str, Any]
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_mapping = {}
        node_data_obj = KnowledgeIndexNodeData(**node_data)

        # index chunk variable
        variable_mapping[node_id + ".index_chunk_variable_selector"] = node_data_obj.index_chunk_variable_selector

        # doc_metadata variables
        if node_data_obj.doc_metadata:
            for item in node_data_obj.doc_metadata:
                if isinstance(item.value, list):
                    variable_mapping[node_id + "." + item.metadata_id] = item.value
        
        return variable_mapping

