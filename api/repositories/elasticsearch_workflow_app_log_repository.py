"""
Elasticsearch WorkflowAppLog Repository Implementation

This module provides Elasticsearch-based storage for WorkflowAppLog entities,
offering better performance and scalability for log data management.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from elasticsearch import Elasticsearch

from models.workflow import WorkflowAppLog

logger = logging.getLogger(__name__)


class ElasticsearchWorkflowAppLogRepository:
    """
    Elasticsearch implementation for WorkflowAppLog storage and retrieval.
    
    This repository provides:
    - High-performance log storage in Elasticsearch
    - Time-series optimization with date-based index rotation
    - Multi-tenant data isolation
    - Advanced search and filtering capabilities
    """

    def __init__(self, es_client: Elasticsearch, index_prefix: str = "dify-workflow-app-logs"):
        """
        Initialize the repository with Elasticsearch client.

        Args:
            es_client: Elasticsearch client instance
            index_prefix: Prefix for Elasticsearch indices
        """
        self._es_client = es_client
        self._index_prefix = index_prefix

        # Ensure index template exists
        self._ensure_index_template()

    def _get_index_name(self, tenant_id: str, date: Optional[datetime] = None) -> str:
        """
        Generate index name with date-based rotation.
        
        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            date: Date for index name generation, defaults to current date
            
        Returns:
            Index name in format: {prefix}-{tenant_id}-{YYYY.MM}
        """
        if date is None:
            date = datetime.utcnow()
        
        return f"{self._index_prefix}-{tenant_id}-{date.strftime('%Y.%m')}"

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
                },
                "mappings": {
                    "properties": {
                        "id": {"type": "keyword"},
                        "tenant_id": {"type": "keyword"},
                        "app_id": {"type": "keyword"},
                        "workflow_id": {"type": "keyword"},
                        "workflow_run_id": {"type": "keyword"},
                        "created_from": {"type": "keyword"},
                        "created_by_role": {"type": "keyword"},
                        "created_by": {"type": "keyword"},
                        "created_at": {"type": "date"},
                    }
                }
            }
        }

        try:
            self._es_client.indices.put_index_template(
                name=template_name,
                body=template_body
            )
            logger.info("Index template %s created/updated successfully", template_name)
        except Exception as e:
            logger.error("Failed to create index template %s: %s", template_name, e)
            raise

    def _to_es_document(self, app_log: WorkflowAppLog) -> dict[str, Any]:
        """
        Convert WorkflowAppLog model to Elasticsearch document.
        
        Args:
            app_log: The WorkflowAppLog model to convert
            
        Returns:
            Dictionary representing the Elasticsearch document
        """
        return {
            "id": app_log.id,
            "tenant_id": app_log.tenant_id,
            "app_id": app_log.app_id,
            "workflow_id": app_log.workflow_id,
            "workflow_run_id": app_log.workflow_run_id,
            "created_from": app_log.created_from,
            "created_by_role": app_log.created_by_role,
            "created_by": app_log.created_by,
            "created_at": app_log.created_at.isoformat() if app_log.created_at else None,
        }

    def _from_es_document(self, doc: dict[str, Any]) -> WorkflowAppLog:
        """
        Convert Elasticsearch document to WorkflowAppLog model.
        
        Args:
            doc: Elasticsearch document
            
        Returns:
            WorkflowAppLog model instance
        """
        source = doc.get("_source", doc)
        
        app_log = WorkflowAppLog()
        app_log.id = source["id"]
        app_log.tenant_id = source["tenant_id"]
        app_log.app_id = source["app_id"]
        app_log.workflow_id = source["workflow_id"]
        app_log.workflow_run_id = source["workflow_run_id"]
        app_log.created_from = source["created_from"]
        app_log.created_by_role = source["created_by_role"]
        app_log.created_by = source["created_by"]
        app_log.created_at = datetime.fromisoformat(source["created_at"]) if source.get("created_at") else None
        
        return app_log

    def save(self, app_log: WorkflowAppLog) -> None:
        """
        Save a WorkflowAppLog to Elasticsearch.
        
        Args:
            app_log: The WorkflowAppLog to save
        """
        try:
            index_name = self._get_index_name(app_log.tenant_id, app_log.created_at)
            doc = self._to_es_document(app_log)
            
            self._es_client.index(
                index=index_name,
                id=app_log.id,
                body=doc,
                refresh="wait_for"
            )
            
            logger.debug(f"Saved workflow app log {app_log.id} to index {index_name}")
            
        except Exception as e:
            logger.error(f"Failed to save workflow app log {app_log.id}: {e}")
            raise

    def get_by_id(self, tenant_id: str, log_id: str) -> Optional[WorkflowAppLog]:
        """
        Get a WorkflowAppLog by ID.
        
        Args:
            tenant_id: Tenant identifier
            log_id: Log ID
            
        Returns:
            WorkflowAppLog if found, None otherwise
        """
        try:
            query = {
                "bool": {
                    "must": [
                        {"term": {"id": log_id}},
                        {"term": {"tenant_id": tenant_id}},
                    ]
                }
            }

            index_pattern = f"{self._index_prefix}-{tenant_id}-*"
            
            response = self._es_client.search(
                index=index_pattern,
                body={
                    "query": query,
                    "size": 1
                }
            )

            if response["hits"]["total"]["value"] > 0:
                hit = response["hits"]["hits"][0]
                return self._from_es_document(hit)

            return None

        except Exception as e:
            logger.error("Failed to get workflow app log %s: %s", log_id, e)
            raise

    def get_paginated_logs(
        self,
        tenant_id: str,
        app_id: str,
        created_at_after: Optional[datetime] = None,
        created_at_before: Optional[datetime] = None,
        created_from: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Get paginated workflow app logs with filtering.
        
        Args:
            tenant_id: Tenant identifier
            app_id: App identifier
            created_at_after: Filter logs created after this date
            created_at_before: Filter logs created before this date
            created_from: Filter by creation source
            limit: Maximum number of results
            offset: Offset for pagination
            
        Returns:
            Dictionary with paginated results
        """
        try:
            # Build query
            must_clauses = [
                {"term": {"tenant_id": tenant_id}},
                {"term": {"app_id": app_id}},
            ]
            
            if created_from:
                must_clauses.append({"term": {"created_from": created_from}})
            
            # Date range filter
            if created_at_after or created_at_before:
                range_query = {}
                if created_at_after:
                    range_query["gte"] = created_at_after.isoformat()
                if created_at_before:
                    range_query["lte"] = created_at_before.isoformat()
                must_clauses.append({"range": {"created_at": range_query}})

            query = {"bool": {"must": must_clauses}}

            index_pattern = f"{self._index_prefix}-{tenant_id}-*"
            
            response = self._es_client.search(
                index=index_pattern,
                body={
                    "query": query,
                    "sort": [{"created_at": {"order": "desc"}}],
                    "size": limit,
                    "from": offset
                }
            )

            # Convert results
            app_logs = []
            for hit in response["hits"]["hits"]:
                app_log = self._from_es_document(hit)
                app_logs.append(app_log)

            return {
                "data": app_logs,
                "total": response["hits"]["total"]["value"],
                "limit": limit,
                "offset": offset,
                "has_more": response["hits"]["total"]["value"] > offset + limit
            }

        except Exception as e:
            logger.error("Failed to get paginated workflow app logs: %s", e)
            raise

    def delete_by_app(self, tenant_id: str, app_id: str) -> int:
        """
        Delete all workflow app logs for a specific app.
        
        Args:
            tenant_id: Tenant identifier
            app_id: App identifier
            
        Returns:
            Number of deleted documents
        """
        try:
            query = {
                "bool": {
                    "must": [
                        {"term": {"tenant_id": tenant_id}},
                        {"term": {"app_id": app_id}},
                    ]
                }
            }

            index_pattern = f"{self._index_prefix}-{tenant_id}-*"
            
            response = self._es_client.delete_by_query(
                index=index_pattern,
                body={"query": query},
                refresh=True
            )

            deleted_count = response.get("deleted", 0)
            logger.info("Deleted %s workflow app logs for app %s", deleted_count, app_id)
            return deleted_count

        except Exception as e:
            logger.error("Failed to delete workflow app logs for app %s: %s", app_id, e)
            raise

    def delete_expired_logs(self, tenant_id: str, before_date: datetime) -> int:
        """
        Delete expired workflow app logs.
        
        Args:
            tenant_id: Tenant identifier
            before_date: Delete logs created before this date
            
        Returns:
            Number of deleted documents
        """
        try:
            query = {
                "bool": {
                    "must": [
                        {"term": {"tenant_id": tenant_id}},
                        {"range": {"created_at": {"lt": before_date.isoformat()}}},
                    ]
                }
            }

            index_pattern = f"{self._index_prefix}-{tenant_id}-*"
            
            response = self._es_client.delete_by_query(
                index=index_pattern,
                body={"query": query},
                refresh=True
            )

            deleted_count = response.get("deleted", 0)
            logger.info("Deleted %s expired workflow app logs for tenant %s", deleted_count, tenant_id)
            return deleted_count

        except Exception as e:
            logger.error("Failed to delete expired workflow app logs: %s", e)
            raise

    def cleanup_old_indices(self, tenant_id: str, retention_days: int = 30) -> None:
        """
        Clean up old indices based on retention policy.
        
        Args:
            tenant_id: Tenant identifier
            retention_days: Number of days to retain data
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
            cutoff_month = cutoff_date.strftime('%Y.%m')
            
            # Get all indices matching our pattern
            index_pattern = f"{self._index_prefix}-{tenant_id}-*"
            indices = self._es_client.indices.get(index=index_pattern)
            
            indices_to_delete = []
            for index_name in indices.keys():
                # Extract date from index name
                try:
                    date_part = index_name.split('-')[-1]  # Get YYYY.MM part
                    if date_part < cutoff_month:
                        indices_to_delete.append(index_name)
                except (IndexError, ValueError):
                    continue
            
            if indices_to_delete:
                self._es_client.indices.delete(index=','.join(indices_to_delete))
                logger.info("Deleted old indices: %s", indices_to_delete)
            
        except Exception as e:
            logger.error("Failed to cleanup old indices: %s", e)
            raise
