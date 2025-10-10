"""
Elasticsearch API WorkflowRun Repository Implementation

This module provides the Elasticsearch-based implementation of the APIWorkflowRunRepository
protocol. It handles service-layer WorkflowRun database operations using Elasticsearch
for better performance and scalability.

Key Features:
- High-performance log storage and retrieval in Elasticsearch
- Time-series data optimization with date-based index rotation
- Full-text search capabilities for workflow run data
- Multi-tenant data isolation through index patterns
- Efficient pagination and filtering
"""

import json
import logging
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError
from sqlalchemy.orm import sessionmaker

from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository

logger = logging.getLogger(__name__)


class ElasticsearchAPIWorkflowRunRepository(APIWorkflowRunRepository):
    """
    Elasticsearch implementation of APIWorkflowRunRepository.

    Provides service-layer WorkflowRun operations using Elasticsearch for
    improved performance and scalability. Supports time-series optimization
    with automatic index rotation and multi-tenant data isolation.

    Args:
        es_client: Elasticsearch client instance
        index_prefix: Prefix for Elasticsearch indices
    """

    def __init__(self, session_maker: sessionmaker, index_prefix: str = "dify-workflow-runs"):
        """
        Initialize the repository with Elasticsearch client.

        Args:
            session_maker: SQLAlchemy sessionmaker (for compatibility with factory pattern)
            index_prefix: Prefix for Elasticsearch indices
        """
        # Get Elasticsearch client from global extension
        from extensions.ext_elasticsearch import elasticsearch as es_extension
        
        self._es_client = es_extension.client
        if not self._es_client:
            raise ValueError("Elasticsearch client is not available. Please check your configuration.")
        
        self._index_prefix = index_prefix

        # Ensure index template exists
        self._ensure_index_template()

    def _get_index_name(self, tenant_id: str, date: Optional[datetime] = None) -> str:
        """
        Generate index name with date-based rotation for better performance.
        
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
                    "index.mapping.total_fields.limit": 2000,
                },
                "mappings": {
                    "properties": {
                        "id": {"type": "keyword"},
                        "tenant_id": {"type": "keyword"},
                        "app_id": {"type": "keyword"},
                        "workflow_id": {"type": "keyword"},
                        "type": {"type": "keyword"},
                        "triggered_from": {"type": "keyword"},
                        "version": {"type": "keyword"},
                        "graph": {"type": "object", "enabled": False},
                        "inputs": {"type": "object", "enabled": False},
                        "status": {"type": "keyword"},
                        "outputs": {"type": "object", "enabled": False},
                        "error": {"type": "text"},
                        "elapsed_time": {"type": "float"},
                        "total_tokens": {"type": "long"},
                        "total_steps": {"type": "integer"},
                        "created_by_role": {"type": "keyword"},
                        "created_by": {"type": "keyword"},
                        "created_at": {"type": "date"},
                        "finished_at": {"type": "date"},
                        "exceptions_count": {"type": "integer"},
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

    def _to_es_document(self, workflow_run: WorkflowRun) -> Dict[str, Any]:
        """
        Convert WorkflowRun model to Elasticsearch document.
        
        Args:
            workflow_run: The WorkflowRun model to convert
            
        Returns:
            Dictionary representing the Elasticsearch document
        """
        doc = {
            "id": workflow_run.id,
            "tenant_id": workflow_run.tenant_id,
            "app_id": workflow_run.app_id,
            "workflow_id": workflow_run.workflow_id,
            "type": workflow_run.type,
            "triggered_from": workflow_run.triggered_from,
            "version": workflow_run.version,
            "graph": workflow_run.graph_dict,
            "inputs": workflow_run.inputs_dict,
            "status": workflow_run.status,
            "outputs": workflow_run.outputs_dict,
            "error": workflow_run.error,
            "elapsed_time": workflow_run.elapsed_time,
            "total_tokens": workflow_run.total_tokens,
            "total_steps": workflow_run.total_steps,
            "created_by_role": workflow_run.created_by_role,
            "created_by": workflow_run.created_by,
            "created_at": workflow_run.created_at.isoformat() if workflow_run.created_at else None,
            "finished_at": workflow_run.finished_at.isoformat() if workflow_run.finished_at else None,
            "exceptions_count": workflow_run.exceptions_count,
        }
        
        # Remove None values to reduce storage size
        return {k: v for k, v in doc.items() if v is not None}

    def _from_es_document(self, doc: Dict[str, Any]) -> WorkflowRun:
        """
        Convert Elasticsearch document to WorkflowRun model.
        
        Args:
            doc: Elasticsearch document
            
        Returns:
            WorkflowRun model instance
        """
        source = doc.get("_source", doc)
        
        return WorkflowRun.from_dict({
            "id": source["id"],
            "tenant_id": source["tenant_id"],
            "app_id": source["app_id"],
            "workflow_id": source["workflow_id"],
            "type": source["type"],
            "triggered_from": source["triggered_from"],
            "version": source["version"],
            "graph": source.get("graph", {}),
            "inputs": source.get("inputs", {}),
            "status": source["status"],
            "outputs": source.get("outputs", {}),
            "error": source.get("error"),
            "elapsed_time": source.get("elapsed_time", 0.0),
            "total_tokens": source.get("total_tokens", 0),
            "total_steps": source.get("total_steps", 0),
            "created_by_role": source["created_by_role"],
            "created_by": source["created_by"],
            "created_at": datetime.fromisoformat(source["created_at"]) if source.get("created_at") else None,
            "finished_at": datetime.fromisoformat(source["finished_at"]) if source.get("finished_at") else None,
            "exceptions_count": source.get("exceptions_count", 0),
        })

    def save(self, workflow_run: WorkflowRun) -> None:
        """
        Save or update a WorkflowRun to Elasticsearch.
        
        Args:
            workflow_run: The WorkflowRun to save
        """
        try:
            index_name = self._get_index_name(workflow_run.tenant_id, workflow_run.created_at)
            doc = self._to_es_document(workflow_run)
            
            self._es_client.index(
                index=index_name,
                id=workflow_run.id,
                body=doc,
                refresh="wait_for"
            )
            
            logger.debug(f"Saved workflow run {workflow_run.id} to index {index_name}")
            
        except Exception as e:
            logger.error(f"Failed to save workflow run {workflow_run.id}: {e}")
            raise

    def get_paginated_workflow_runs(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        limit: int = 20,
        last_id: str | None = None,
    ) -> InfiniteScrollPagination:
        """
        Get paginated workflow runs with filtering using Elasticsearch.

        Implements cursor-based pagination using created_at timestamps for
        efficient handling of large datasets.
        """
        try:
            # Build query
            query = {
                "bool": {
                    "must": [
                        {"term": {"tenant_id": tenant_id}},
                        {"term": {"app_id": app_id}},
                        {"term": {"triggered_from": triggered_from}},
                    ]
                }
            }

            # Handle cursor-based pagination
            sort_config = [{"created_at": {"order": "desc"}}]
            
            if last_id:
                # Get the last workflow run for cursor-based pagination
                last_run = self.get_workflow_run_by_id(tenant_id, app_id, last_id)
                if not last_run:
                    raise ValueError("Last workflow run not exists")
                
                # Add range query for pagination
                query["bool"]["must"].append({
                    "range": {
                        "created_at": {
                            "lt": last_run.created_at.isoformat()
                        }
                    }
                })

            # Search across all indices for this tenant
            index_pattern = f"{self._index_prefix}-{tenant_id}-*"
            
            response = self._es_client.search(
                index=index_pattern,
                body={
                    "query": query,
                    "sort": sort_config,
                    "size": limit + 1,  # Get one extra to check if there are more
                }
            )

            # Convert results
            workflow_runs = []
            for hit in response["hits"]["hits"]:
                workflow_run = self._from_es_document(hit)
                workflow_runs.append(workflow_run)

            # Check if there are more records for pagination
            has_more = len(workflow_runs) > limit
            if has_more:
                workflow_runs = workflow_runs[:-1]

            return InfiniteScrollPagination(data=workflow_runs, limit=limit, has_more=has_more)

        except Exception as e:
            logger.error(f"Failed to get paginated workflow runs: {e}")
            raise

    def get_workflow_run_by_id(
        self,
        tenant_id: str,
        app_id: str,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID with tenant and app isolation.
        """
        try:
            query = {
                "bool": {
                    "must": [
                        {"term": {"id": run_id}},
                        {"term": {"tenant_id": tenant_id}},
                        {"term": {"app_id": app_id}},
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
            logger.error(f"Failed to get workflow run {run_id}: {e}")
            raise

    def get_expired_runs_batch(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> Sequence[WorkflowRun]:
        """
        Get a batch of expired workflow runs for cleanup operations.
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
            
            response = self._es_client.search(
                index=index_pattern,
                body={
                    "query": query,
                    "sort": [{"created_at": {"order": "asc"}}],
                    "size": batch_size
                }
            )

            workflow_runs = []
            for hit in response["hits"]["hits"]:
                workflow_run = self._from_es_document(hit)
                workflow_runs.append(workflow_run)

            return workflow_runs

        except Exception as e:
            logger.error(f"Failed to get expired runs batch: {e}")
            raise

    def delete_runs_by_ids(
        self,
        run_ids: Sequence[str],
    ) -> int:
        """
        Delete workflow runs by their IDs using bulk deletion.
        """
        if not run_ids:
            return 0

        try:
            query = {
                "terms": {"id": list(run_ids)}
            }

            # We need to search across all indices since we don't know the tenant_id
            # In practice, you might want to pass tenant_id as a parameter
            index_pattern = f"{self._index_prefix}-*"
            
            response = self._es_client.delete_by_query(
                index=index_pattern,
                body={"query": query},
                refresh=True
            )

            deleted_count = response.get("deleted", 0)
            logger.info(f"Deleted {deleted_count} workflow runs by IDs")
            return deleted_count

        except Exception as e:
            logger.error(f"Failed to delete workflow runs by IDs: {e}")
            raise

    def delete_runs_by_app(
        self,
        tenant_id: str,
        app_id: str,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete all workflow runs for a specific app in batches.
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
                refresh=True,
                wait_for_completion=True
            )

            deleted_count = response.get("deleted", 0)
            logger.info(f"Deleted {deleted_count} workflow runs for app {app_id}")
            return deleted_count

        except Exception as e:
            logger.error(f"Failed to delete workflow runs for app {app_id}: {e}")
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
                logger.info(f"Deleted old indices: {indices_to_delete}")
            
        except Exception as e:
            logger.error(f"Failed to cleanup old indices: {e}")
            raise

    def search_workflow_runs(
        self,
        tenant_id: str,
        app_id: str | None = None,
        keyword: str | None = None,
        status: str | None = None,
        created_at_after: datetime | None = None,
        created_at_before: datetime | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Advanced search for workflow runs with full-text search capabilities.
        
        Args:
            tenant_id: Tenant identifier
            app_id: Optional app filter
            keyword: Search keyword for full-text search
            status: Status filter
            created_at_after: Filter runs created after this date
            created_at_before: Filter runs created before this date
            limit: Maximum number of results
            offset: Offset for pagination
            
        Returns:
            Dictionary with search results and metadata
        """
        try:
            # Build query
            must_clauses = [{"term": {"tenant_id": tenant_id}}]
            
            if app_id:
                must_clauses.append({"term": {"app_id": app_id}})
            
            if status:
                must_clauses.append({"term": {"status": status}})
            
            # Date range filter
            if created_at_after or created_at_before:
                range_query = {}
                if created_at_after:
                    range_query["gte"] = created_at_after.isoformat()
                if created_at_before:
                    range_query["lte"] = created_at_before.isoformat()
                must_clauses.append({"range": {"created_at": range_query}})
            
            query = {"bool": {"must": must_clauses}}
            
            # Add full-text search if keyword provided
            if keyword:
                query["bool"]["should"] = [
                    {"match": {"inputs": keyword}},
                    {"match": {"outputs": keyword}},
                    {"match": {"error": keyword}},
                ]
                query["bool"]["minimum_should_match"] = 1

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
            workflow_runs = []
            for hit in response["hits"]["hits"]:
                workflow_run = self._from_es_document(hit)
                workflow_runs.append(workflow_run)

            return {
                "data": workflow_runs,
                "total": response["hits"]["total"]["value"],
                "limit": limit,
                "offset": offset,
                "has_more": response["hits"]["total"]["value"] > offset + limit
            }

        except Exception as e:
            logger.error(f"Failed to search workflow runs: {e}")
            raise
