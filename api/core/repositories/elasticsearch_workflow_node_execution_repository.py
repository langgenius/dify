"""
Elasticsearch implementation of the WorkflowNodeExecutionRepository.

This implementation stores workflow node execution logs in Elasticsearch for better
performance and scalability compared to PostgreSQL storage.
"""

import json
import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Dict, Optional, Union

from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError, RequestError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.repositories.workflow_node_execution_repository import (
    OrderConfig,
    WorkflowNodeExecutionRepository,
)
from libs.helper import extract_tenant_id
from models import Account, CreatorUserRole, EndUser
from models.workflow import WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class ElasticsearchWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    Elasticsearch implementation of the WorkflowNodeExecutionRepository interface.
    
    This implementation provides:
    - High-performance log storage and retrieval
    - Full-text search capabilities
    - Time-series data optimization
    - Automatic index management with date-based rotation
    - Multi-tenancy support through index patterns
    """

    def __init__(
        self,
        session_factory: Union[sessionmaker, Engine],
        user: Union[Account, EndUser],
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
        index_prefix: str = "dify-workflow-node-executions",
    ):
        """
        Initialize the repository with Elasticsearch client and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine (for compatibility with factory pattern)
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
            index_prefix: Prefix for Elasticsearch indices
        """
        # Get Elasticsearch client from global extension
        from extensions.ext_elasticsearch import elasticsearch as es_extension
        
        self._es_client = es_extension.client
        if not self._es_client:
            raise ValueError("Elasticsearch client is not available. Please check your configuration.")
        
        self._index_prefix = index_prefix

        # Extract tenant_id from user
        tenant_id = extract_tenant_id(user)
        if not tenant_id:
            raise ValueError("User must have a tenant_id or current_tenant_id")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        # In-memory cache for workflow node executions
        self._execution_cache: Dict[str, WorkflowNodeExecution] = {}

        # Ensure index template exists
        self._ensure_index_template()

    def _get_index_name(self, date: Optional[datetime] = None) -> str:
        """
        Generate index name with date-based rotation for better performance.
        
        Args:
            date: Date for index name generation, defaults to current date
            
        Returns:
            Index name in format: {prefix}-{tenant_id}-{YYYY.MM}
        """
        if date is None:
            date = datetime.utcnow()
        
        return f"{self._index_prefix}-{self._tenant_id}-{date.strftime('%Y.%m')}"

    def _ensure_index_template(self):
        """
        Ensure the index template exists for proper mapping and settings.
        """
        template_name = f"{self._index_prefix}-template"
        template_body = {
            "index_patterns": [f"{self._index_prefix}-*"],
            "template": {
                "settings": {
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "index.refresh_interval": "5s",
                    "index.mapping.total_fields.limit": 2000,
                },
                "mappings": {
                    "properties": {
                        "id": {"type": "keyword"},
                        "tenant_id": {"type": "keyword"},
                        "app_id": {"type": "keyword"},
                        "workflow_id": {"type": "keyword"},
                        "workflow_execution_id": {"type": "keyword"},
                        "node_execution_id": {"type": "keyword"},
                        "triggered_from": {"type": "keyword"},
                        "index": {"type": "integer"},
                        "predecessor_node_id": {"type": "keyword"},
                        "node_id": {"type": "keyword"},
                        "node_type": {"type": "keyword"},
                        "title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                        "inputs": {"type": "object", "enabled": False},
                        "process_data": {"type": "object", "enabled": False},
                        "outputs": {"type": "object", "enabled": False},
                        "status": {"type": "keyword"},
                        "error": {"type": "text"},
                        "elapsed_time": {"type": "float"},
                        "metadata": {"type": "object", "enabled": False},
                        "created_at": {"type": "date"},
                        "finished_at": {"type": "date"},
                        "created_by_role": {"type": "keyword"},
                        "created_by": {"type": "keyword"},
                    }
                }
            }
        }

        try:
            self._es_client.indices.put_index_template(
                name=template_name,
                body=template_body
            )
            logger.info(f"Index template {template_name} created/updated successfully")
        except Exception as e:
            logger.error(f"Failed to create index template {template_name}: {e}")
            raise

    def _serialize_complex_data(self, data: Any) -> Any:
        """
        Serialize complex data structures to JSON-serializable format.
        
        Args:
            data: Data to serialize
            
        Returns:
            JSON-serializable data
        """
        if data is None:
            return None
            
        # Use Dify's existing JSON encoder for complex objects
        from core.model_runtime.utils.encoders import jsonable_encoder
        
        try:
            return jsonable_encoder(data)
        except Exception as e:
            logger.warning(f"Failed to serialize complex data, using string representation: {e}")
            return str(data)

    def _to_es_document(self, execution: WorkflowNodeExecution) -> Dict[str, Any]:
        """
        Convert WorkflowNodeExecution domain entity to Elasticsearch document.
        
        Args:
            execution: The domain entity to convert
            
        Returns:
            Dictionary representing the Elasticsearch document
        """
        doc = {
            "id": execution.id,
            "tenant_id": self._tenant_id,
            "app_id": self._app_id,
            "workflow_id": execution.workflow_id,
            "workflow_execution_id": execution.workflow_execution_id,
            "node_execution_id": execution.node_execution_id,
            "triggered_from": self._triggered_from.value if self._triggered_from else None,
            "index": execution.index,
            "predecessor_node_id": execution.predecessor_node_id,
            "node_id": execution.node_id,
            "node_type": execution.node_type.value,
            "title": execution.title,
            "inputs": self._serialize_complex_data(execution.inputs),
            "process_data": self._serialize_complex_data(execution.process_data),
            "outputs": self._serialize_complex_data(execution.outputs),
            "status": execution.status.value,
            "error": execution.error,
            "elapsed_time": execution.elapsed_time,
            "metadata": self._serialize_complex_data(execution.metadata),
            "created_at": execution.created_at.isoformat() if execution.created_at else None,
            "finished_at": execution.finished_at.isoformat() if execution.finished_at else None,
            "created_by_role": self._creator_user_role.value,
            "created_by": self._creator_user_id,
        }
        
        # Remove None values to reduce storage size
        return {k: v for k, v in doc.items() if v is not None}

    def _from_es_document(self, doc: Dict[str, Any]) -> WorkflowNodeExecution:
        """
        Convert Elasticsearch document to WorkflowNodeExecution domain entity.
        
        Args:
            doc: Elasticsearch document
            
        Returns:
            WorkflowNodeExecution domain entity
        """
        from core.workflow.enums import NodeType
        
        source = doc.get("_source", doc)
        
        return WorkflowNodeExecution(
            id=source["id"],
            node_execution_id=source.get("node_execution_id"),
            workflow_id=source["workflow_id"],
            workflow_execution_id=source.get("workflow_execution_id"),
            index=source["index"],
            predecessor_node_id=source.get("predecessor_node_id"),
            node_id=source["node_id"],
            node_type=NodeType(source["node_type"]),
            title=source["title"],
            inputs=source.get("inputs"),
            process_data=source.get("process_data"),
            outputs=source.get("outputs"),
            status=WorkflowNodeExecutionStatus(source["status"]),
            error=source.get("error"),
            elapsed_time=source.get("elapsed_time", 0.0),
            metadata=source.get("metadata", {}),
            created_at=datetime.fromisoformat(source["created_at"]) if source.get("created_at") else None,
            finished_at=datetime.fromisoformat(source["finished_at"]) if source.get("finished_at") else None,
        )

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a NodeExecution domain entity to Elasticsearch.
        
        Args:
            execution: The NodeExecution domain entity to persist
        """
        try:
            index_name = self._get_index_name(execution.created_at)
            doc = self._to_es_document(execution)
            
            # Use upsert to handle both create and update operations
            self._es_client.index(
                index=index_name,
                id=execution.id,
                body=doc,
                refresh="wait_for"  # Ensure document is searchable immediately
            )
            
            # Update cache
            self._execution_cache[execution.id] = execution
            
            logger.debug(f"Saved workflow node execution {execution.id} to index {index_name}")
            
        except Exception as e:
            logger.error(f"Failed to save workflow node execution {execution.id}: {e}")
            raise

    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update the inputs, process_data, or outputs for a node execution.
        
        Args:
            execution: The NodeExecution with updated data
        """
        try:
            index_name = self._get_index_name(execution.created_at)
            
            # Prepare partial update document
            update_doc = {}
            if execution.inputs is not None:
                update_doc["inputs"] = execution.inputs
            if execution.process_data is not None:
                update_doc["process_data"] = execution.process_data
            if execution.outputs is not None:
                update_doc["outputs"] = execution.outputs
            
            if update_doc:
                # Serialize complex data in update document
                serialized_update_doc = {}
                for key, value in update_doc.items():
                    serialized_update_doc[key] = self._serialize_complex_data(value)
                
                self._es_client.update(
                    index=index_name,
                    id=execution.id,
                    body={"doc": serialized_update_doc},
                    refresh="wait_for"
                )
                
                # Update cache
                if execution.id in self._execution_cache:
                    cached_execution = self._execution_cache[execution.id]
                    if execution.inputs is not None:
                        cached_execution.inputs = execution.inputs
                    if execution.process_data is not None:
                        cached_execution.process_data = execution.process_data
                    if execution.outputs is not None:
                        cached_execution.outputs = execution.outputs
                
                logger.debug(f"Updated execution data for {execution.id}")
                
        except NotFoundError:
            # Document doesn't exist, create it
            self.save(execution)
        except Exception as e:
            logger.error(f"Failed to update execution data for {execution.id}: {e}")
            raise

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all NodeExecution instances for a specific workflow run.
        
        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
            
        Returns:
            A list of NodeExecution instances
        """
        try:
            # Build query
            query = {
                "bool": {
                    "must": [
                        {"term": {"tenant_id": self._tenant_id}},
                        {"term": {"workflow_execution_id": workflow_run_id}},
                    ]
                }
            }
            
            if self._app_id:
                query["bool"]["must"].append({"term": {"app_id": self._app_id}})
            
            if self._triggered_from:
                query["bool"]["must"].append({"term": {"triggered_from": self._triggered_from.value}})
            
            # Build sort configuration
            sort_config = []
            if order_config and order_config.order_by:
                for field in order_config.order_by:
                    direction = "desc" if order_config.order_direction == "desc" else "asc"
                    sort_config.append({field: {"order": direction}})
            else:
                # Default sort by index and created_at
                sort_config = [
                    {"index": {"order": "asc"}},
                    {"created_at": {"order": "asc"}}
                ]
            
            # Search across all indices for this tenant
            index_pattern = f"{self._index_prefix}-{self._tenant_id}-*"
            
            response = self._es_client.search(
                index=index_pattern,
                body={
                    "query": query,
                    "sort": sort_config,
                    "size": 10000,  # Adjust based on expected max executions per workflow
                }
            )
            
            executions = []
            for hit in response["hits"]["hits"]:
                execution = self._from_es_document(hit)
                executions.append(execution)
                # Update cache
                self._execution_cache[execution.id] = execution
            
            return executions
            
        except Exception as e:
            logger.error(f"Failed to retrieve executions for workflow run {workflow_run_id}: {e}")
            raise
