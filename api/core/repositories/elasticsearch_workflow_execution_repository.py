"""
Elasticsearch implementation of the WorkflowExecutionRepository.

This implementation stores workflow execution data in Elasticsearch for better
performance and scalability compared to PostgreSQL storage.
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional, Union

from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.entities import WorkflowExecution
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from libs.helper import extract_tenant_id
from models import Account, CreatorUserRole, EndUser
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


class ElasticsearchWorkflowExecutionRepository(WorkflowExecutionRepository):
    """
    Elasticsearch implementation of the WorkflowExecutionRepository interface.
    
    This implementation provides:
    - High-performance workflow execution storage
    - Time-series data optimization with date-based index rotation
    - Multi-tenant data isolation
    - Advanced search and analytics capabilities
    """

    def __init__(
        self,
        session_factory: Union[sessionmaker, Engine],
        user: Union[Account, EndUser],
        app_id: str,
        triggered_from: WorkflowRunTriggeredFrom,
        index_prefix: str = "dify-workflow-executions",
    ):
        """
        Initialize the repository with Elasticsearch client and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine (for compatibility with factory pattern)
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application
            triggered_from: Source of the execution trigger
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
                        "workflow_version": {"type": "keyword"},
                        "workflow_type": {"type": "keyword"},
                        "triggered_from": {"type": "keyword"},
                        "inputs": {"type": "object", "enabled": False},
                        "outputs": {"type": "object", "enabled": False},
                        "status": {"type": "keyword"},
                        "error_message": {"type": "text"},
                        "elapsed_time": {"type": "float"},
                        "total_tokens": {"type": "long"},
                        "total_steps": {"type": "integer"},
                        "exceptions_count": {"type": "integer"},
                        "created_by_role": {"type": "keyword"},
                        "created_by": {"type": "keyword"},
                        "started_at": {"type": "date"},
                        "finished_at": {"type": "date"},
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

    def _to_workflow_run_document(self, execution: WorkflowExecution) -> Dict[str, Any]:
        """
        Convert WorkflowExecution domain entity to WorkflowRun-compatible document.
        This follows the same logic as SQLAlchemy implementation.
        
        Args:
            execution: The domain entity to convert
            
        Returns:
            Dictionary representing the WorkflowRun document for Elasticsearch
        """
        # Calculate elapsed time (same logic as SQL implementation)
        elapsed_time = 0.0
        if execution.finished_at:
            elapsed_time = (execution.finished_at - execution.started_at).total_seconds()
        
        doc = {
            "id": execution.id_,
            "tenant_id": self._tenant_id,
            "app_id": self._app_id,
            "workflow_id": execution.workflow_id,
            "type": execution.workflow_type.value,
            "triggered_from": self._triggered_from.value,
            "version": execution.workflow_version,
            "graph": self._serialize_complex_data(execution.graph),
            "inputs": self._serialize_complex_data(execution.inputs),
            "status": execution.status.value,
            "outputs": self._serialize_complex_data(execution.outputs),
            "error": execution.error_message or None,
            "elapsed_time": elapsed_time,
            "total_tokens": execution.total_tokens,
            "total_steps": execution.total_steps,
            "created_by_role": self._creator_user_role.value,
            "created_by": self._creator_user_id,
            "created_at": execution.started_at.isoformat() if execution.started_at else None,
            "finished_at": execution.finished_at.isoformat() if execution.finished_at else None,
            "exceptions_count": execution.exceptions_count,
        }
        
        # Remove None values to reduce storage size
        return {k: v for k, v in doc.items() if v is not None}

    def save(self, execution: WorkflowExecution) -> None:
        """
        Save or update a WorkflowExecution instance to Elasticsearch.
        
        Following the SQL implementation pattern, this saves the WorkflowExecution
        as WorkflowRun-compatible data that APIs can consume.

        Args:
            execution: The WorkflowExecution instance to save or update
        """
        try:
            # Convert to WorkflowRun-compatible document (same as SQL implementation)
            run_doc = self._to_workflow_run_document(execution)
            
            # Save to workflow-runs index (this is what APIs query)
            run_index = f"dify-workflow-runs-{self._tenant_id}-{execution.started_at.strftime('%Y.%m')}"
            
            self._es_client.index(
                index=run_index,
                id=execution.id_,
                body=run_doc,
                refresh="wait_for"  # Ensure document is searchable immediately
            )
            
            logger.debug(f"Saved workflow execution {execution.id_} as WorkflowRun to index {run_index}")
            
        except Exception as e:
            logger.error(f"Failed to save workflow execution {execution.id_}: {e}")
            raise