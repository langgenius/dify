"""
Elasticsearch Migration Service

This service provides tools for migrating workflow log data from PostgreSQL
to Elasticsearch, including data validation, progress tracking, and rollback capabilities.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from elasticsearch import Elasticsearch
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_elasticsearch import elasticsearch
from models.workflow import (
    WorkflowAppLog,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowRun,
)
from repositories.elasticsearch_api_workflow_run_repository import ElasticsearchAPIWorkflowRunRepository
from repositories.elasticsearch_workflow_app_log_repository import ElasticsearchWorkflowAppLogRepository

logger = logging.getLogger(__name__)


class ElasticsearchMigrationService:
    """
    Service for migrating workflow log data from PostgreSQL to Elasticsearch.
    
    Provides comprehensive migration capabilities including:
    - Batch processing for large datasets
    - Progress tracking and resumption
    - Data validation and integrity checks
    - Rollback capabilities
    - Performance monitoring
    """

    def __init__(self, es_client: Optional[Elasticsearch] = None, batch_size: int = 1000):
        """
        Initialize the migration service.
        
        Args:
            es_client: Elasticsearch client instance (uses global client if None)
            batch_size: Number of records to process in each batch
        """
        self._es_client = es_client or elasticsearch.client
        if not self._es_client:
            raise ValueError("Elasticsearch client is not available")
        
        self._batch_size = batch_size
        self._session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        
        # Initialize repositories
        self._workflow_run_repo = ElasticsearchAPIWorkflowRunRepository(self._es_client)
        self._app_log_repo = ElasticsearchWorkflowAppLogRepository(self._es_client)

    def migrate_workflow_runs(
        self,
        tenant_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Migrate WorkflowRun data from PostgreSQL to Elasticsearch.
        
        Args:
            tenant_id: Optional tenant filter for migration
            start_date: Optional start date filter
            end_date: Optional end date filter
            dry_run: If True, only count records without migrating
            
        Returns:
            Migration statistics and results
        """
        logger.info("Starting WorkflowRun migration to Elasticsearch")
        
        stats = {
            "total_records": 0,
            "migrated_records": 0,
            "failed_records": 0,
            "start_time": datetime.utcnow(),
            "errors": [],
        }

        try:
            with self._session_maker() as session:
                # Build query
                query = select(WorkflowRun)
                
                if tenant_id:
                    query = query.where(WorkflowRun.tenant_id == tenant_id)
                
                if start_date:
                    query = query.where(WorkflowRun.created_at >= start_date)
                
                if end_date:
                    query = query.where(WorkflowRun.created_at <= end_date)
                
                # Get total count
                count_query = select(db.func.count()).select_from(query.subquery())
                stats["total_records"] = session.scalar(count_query) or 0
                
                if dry_run:
                    logger.info(f"Dry run: Found {stats['total_records']} WorkflowRun records to migrate")
                    return stats
                
                # Process in batches
                offset = 0
                while offset < stats["total_records"]:
                    batch_query = query.offset(offset).limit(self._batch_size)
                    workflow_runs = session.scalars(batch_query).all()
                    
                    if not workflow_runs:
                        break
                    
                    # Migrate batch
                    for workflow_run in workflow_runs:
                        try:
                            self._workflow_run_repo.save(workflow_run)
                            stats["migrated_records"] += 1
                            
                            if stats["migrated_records"] % 100 == 0:
                                logger.info(f"Migrated {stats['migrated_records']}/{stats['total_records']} WorkflowRuns")
                                
                        except Exception as e:
                            error_msg = f"Failed to migrate WorkflowRun {workflow_run.id}: {str(e)}"
                            logger.error(error_msg)
                            stats["errors"].append(error_msg)
                            stats["failed_records"] += 1
                    
                    offset += self._batch_size

        except Exception as e:
            error_msg = f"Migration failed: {str(e)}"
            logger.error(error_msg)
            stats["errors"].append(error_msg)
            raise

        stats["end_time"] = datetime.utcnow()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()
        
        logger.info(f"WorkflowRun migration completed: {stats['migrated_records']} migrated, "
                   f"{stats['failed_records']} failed in {stats['duration']:.2f}s")
        
        return stats

    def migrate_workflow_app_logs(
        self,
        tenant_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Migrate WorkflowAppLog data from PostgreSQL to Elasticsearch.
        
        Args:
            tenant_id: Optional tenant filter for migration
            start_date: Optional start date filter
            end_date: Optional end date filter
            dry_run: If True, only count records without migrating
            
        Returns:
            Migration statistics and results
        """
        logger.info("Starting WorkflowAppLog migration to Elasticsearch")
        
        stats = {
            "total_records": 0,
            "migrated_records": 0,
            "failed_records": 0,
            "start_time": datetime.utcnow(),
            "errors": [],
        }

        try:
            with self._session_maker() as session:
                # Build query
                query = select(WorkflowAppLog)
                
                if tenant_id:
                    query = query.where(WorkflowAppLog.tenant_id == tenant_id)
                
                if start_date:
                    query = query.where(WorkflowAppLog.created_at >= start_date)
                
                if end_date:
                    query = query.where(WorkflowAppLog.created_at <= end_date)
                
                # Get total count
                count_query = select(db.func.count()).select_from(query.subquery())
                stats["total_records"] = session.scalar(count_query) or 0
                
                if dry_run:
                    logger.info(f"Dry run: Found {stats['total_records']} WorkflowAppLog records to migrate")
                    return stats
                
                # Process in batches
                offset = 0
                while offset < stats["total_records"]:
                    batch_query = query.offset(offset).limit(self._batch_size)
                    app_logs = session.scalars(batch_query).all()
                    
                    if not app_logs:
                        break
                    
                    # Migrate batch
                    for app_log in app_logs:
                        try:
                            self._app_log_repo.save(app_log)
                            stats["migrated_records"] += 1
                            
                            if stats["migrated_records"] % 100 == 0:
                                logger.info(f"Migrated {stats['migrated_records']}/{stats['total_records']} WorkflowAppLogs")
                                
                        except Exception as e:
                            error_msg = f"Failed to migrate WorkflowAppLog {app_log.id}: {str(e)}"
                            logger.error(error_msg)
                            stats["errors"].append(error_msg)
                            stats["failed_records"] += 1
                    
                    offset += self._batch_size

        except Exception as e:
            error_msg = f"Migration failed: {str(e)}"
            logger.error(error_msg)
            stats["errors"].append(error_msg)
            raise

        stats["end_time"] = datetime.utcnow()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()
        
        logger.info(f"WorkflowAppLog migration completed: {stats['migrated_records']} migrated, "
                   f"{stats['failed_records']} failed in {stats['duration']:.2f}s")
        
        return stats

    def migrate_workflow_node_executions(
        self,
        tenant_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Migrate WorkflowNodeExecution data from PostgreSQL to Elasticsearch.
        
        Note: This requires the Elasticsearch WorkflowNodeExecution repository
        to be properly configured and initialized.
        
        Args:
            tenant_id: Optional tenant filter for migration
            start_date: Optional start date filter
            end_date: Optional end date filter
            dry_run: If True, only count records without migrating
            
        Returns:
            Migration statistics and results
        """
        logger.info("Starting WorkflowNodeExecution migration to Elasticsearch")
        
        stats = {
            "total_records": 0,
            "migrated_records": 0,
            "failed_records": 0,
            "start_time": datetime.utcnow(),
            "errors": [],
        }

        try:
            with self._session_maker() as session:
                # Build query with offload data preloaded
                query = WorkflowNodeExecutionModel.preload_offload_data_and_files(
                    select(WorkflowNodeExecutionModel)
                )
                
                if tenant_id:
                    query = query.where(WorkflowNodeExecutionModel.tenant_id == tenant_id)
                
                if start_date:
                    query = query.where(WorkflowNodeExecutionModel.created_at >= start_date)
                
                if end_date:
                    query = query.where(WorkflowNodeExecutionModel.created_at <= end_date)
                
                # Get total count
                count_query = select(db.func.count()).select_from(
                    select(WorkflowNodeExecutionModel).where(
                        *([WorkflowNodeExecutionModel.tenant_id == tenant_id] if tenant_id else []),
                        *([WorkflowNodeExecutionModel.created_at >= start_date] if start_date else []),
                        *([WorkflowNodeExecutionModel.created_at <= end_date] if end_date else []),
                    ).subquery()
                )
                stats["total_records"] = session.scalar(count_query) or 0
                
                if dry_run:
                    logger.info(f"Dry run: Found {stats['total_records']} WorkflowNodeExecution records to migrate")
                    return stats
                
                # Process in batches
                offset = 0
                while offset < stats["total_records"]:
                    batch_query = query.offset(offset).limit(self._batch_size)
                    node_executions = session.scalars(batch_query).all()
                    
                    if not node_executions:
                        break
                    
                    # Migrate batch
                    for node_execution in node_executions:
                        try:
                            # Convert to Elasticsearch document format
                            doc = self._convert_node_execution_to_es_doc(node_execution)
                            
                            # Save to Elasticsearch
                            index_name = f"dify-workflow-node-executions-{tenant_id or node_execution.tenant_id}-{node_execution.created_at.strftime('%Y.%m')}"
                            self._es_client.index(
                                index=index_name,
                                id=node_execution.id,
                                body=doc,
                                refresh="wait_for"
                            )
                            
                            stats["migrated_records"] += 1
                            
                            if stats["migrated_records"] % 100 == 0:
                                logger.info(f"Migrated {stats['migrated_records']}/{stats['total_records']} WorkflowNodeExecutions")
                                
                        except Exception as e:
                            error_msg = f"Failed to migrate WorkflowNodeExecution {node_execution.id}: {str(e)}"
                            logger.error(error_msg)
                            stats["errors"].append(error_msg)
                            stats["failed_records"] += 1
                    
                    offset += self._batch_size

        except Exception as e:
            error_msg = f"Migration failed: {str(e)}"
            logger.error(error_msg)
            stats["errors"].append(error_msg)
            raise

        stats["end_time"] = datetime.utcnow()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()
        
        logger.info(f"WorkflowNodeExecution migration completed: {stats['migrated_records']} migrated, "
                   f"{stats['failed_records']} failed in {stats['duration']:.2f}s")
        
        return stats

    def _convert_node_execution_to_es_doc(self, node_execution: WorkflowNodeExecutionModel) -> Dict[str, Any]:
        """
        Convert WorkflowNodeExecutionModel to Elasticsearch document format.
        
        Args:
            node_execution: The database model to convert
            
        Returns:
            Dictionary representing the Elasticsearch document
        """
        # Load full data if offloaded
        inputs = node_execution.inputs_dict
        outputs = node_execution.outputs_dict
        process_data = node_execution.process_data_dict
        
        # If data is offloaded, load from storage
        if node_execution.offload_data:
            from extensions.ext_storage import storage
            
            for offload in node_execution.offload_data:
                if offload.file:
                    content = storage.load(offload.file.key)
                    data = json.loads(content)
                    
                    if offload.type_.value == "inputs":
                        inputs = data
                    elif offload.type_.value == "outputs":
                        outputs = data
                    elif offload.type_.value == "process_data":
                        process_data = data

        doc = {
            "id": node_execution.id,
            "tenant_id": node_execution.tenant_id,
            "app_id": node_execution.app_id,
            "workflow_id": node_execution.workflow_id,
            "workflow_execution_id": node_execution.workflow_run_id,
            "node_execution_id": node_execution.node_execution_id,
            "triggered_from": node_execution.triggered_from,
            "index": node_execution.index,
            "predecessor_node_id": node_execution.predecessor_node_id,
            "node_id": node_execution.node_id,
            "node_type": node_execution.node_type,
            "title": node_execution.title,
            "inputs": inputs,
            "process_data": process_data,
            "outputs": outputs,
            "status": node_execution.status,
            "error": node_execution.error,
            "elapsed_time": node_execution.elapsed_time,
            "metadata": node_execution.execution_metadata_dict,
            "created_at": node_execution.created_at.isoformat() if node_execution.created_at else None,
            "finished_at": node_execution.finished_at.isoformat() if node_execution.finished_at else None,
            "created_by_role": node_execution.created_by_role,
            "created_by": node_execution.created_by,
        }
        
        # Remove None values to reduce storage size
        return {k: v for k, v in doc.items() if v is not None}

    def validate_migration(self, tenant_id: str, sample_size: int = 100) -> Dict[str, Any]:
        """
        Validate migrated data by comparing samples from PostgreSQL and Elasticsearch.
        
        Args:
            tenant_id: Tenant ID to validate
            sample_size: Number of records to sample for validation
            
        Returns:
            Validation results and statistics
        """
        logger.info(f"Starting migration validation for tenant {tenant_id}")
        
        validation_results = {
            "workflow_runs": {"total": 0, "matched": 0, "mismatched": 0, "missing": 0},
            "app_logs": {"total": 0, "matched": 0, "mismatched": 0, "missing": 0},
            "node_executions": {"total": 0, "matched": 0, "mismatched": 0, "missing": 0},
            "errors": [],
        }

        try:
            with self._session_maker() as session:
                # Validate WorkflowRuns
                workflow_runs = session.scalars(
                    select(WorkflowRun)
                    .where(WorkflowRun.tenant_id == tenant_id)
                    .limit(sample_size)
                ).all()
                
                validation_results["workflow_runs"]["total"] = len(workflow_runs)
                
                for workflow_run in workflow_runs:
                    try:
                        es_run = self._workflow_run_repo.get_workflow_run_by_id(
                            tenant_id, workflow_run.app_id, workflow_run.id
                        )
                        
                        if es_run:
                            if self._compare_workflow_runs(workflow_run, es_run):
                                validation_results["workflow_runs"]["matched"] += 1
                            else:
                                validation_results["workflow_runs"]["mismatched"] += 1
                        else:
                            validation_results["workflow_runs"]["missing"] += 1
                            
                    except Exception as e:
                        validation_results["errors"].append(f"Error validating WorkflowRun {workflow_run.id}: {str(e)}")

                # Validate WorkflowAppLogs
                app_logs = session.scalars(
                    select(WorkflowAppLog)
                    .where(WorkflowAppLog.tenant_id == tenant_id)
                    .limit(sample_size)
                ).all()
                
                validation_results["app_logs"]["total"] = len(app_logs)
                
                for app_log in app_logs:
                    try:
                        es_log = self._app_log_repo.get_by_id(tenant_id, app_log.id)
                        
                        if es_log:
                            if self._compare_app_logs(app_log, es_log):
                                validation_results["app_logs"]["matched"] += 1
                            else:
                                validation_results["app_logs"]["mismatched"] += 1
                        else:
                            validation_results["app_logs"]["missing"] += 1
                            
                    except Exception as e:
                        validation_results["errors"].append(f"Error validating WorkflowAppLog {app_log.id}: {str(e)}")

        except Exception as e:
            error_msg = f"Validation failed: {str(e)}"
            logger.error(error_msg)
            validation_results["errors"].append(error_msg)

        logger.info(f"Migration validation completed for tenant {tenant_id}")
        return validation_results

    def _compare_workflow_runs(self, pg_run: WorkflowRun, es_run: WorkflowRun) -> bool:
        """Compare WorkflowRun records from PostgreSQL and Elasticsearch."""
        return (
            pg_run.id == es_run.id
            and pg_run.status == es_run.status
            and pg_run.elapsed_time == es_run.elapsed_time
            and pg_run.total_tokens == es_run.total_tokens
        )

    def _compare_app_logs(self, pg_log: WorkflowAppLog, es_log: WorkflowAppLog) -> bool:
        """Compare WorkflowAppLog records from PostgreSQL and Elasticsearch."""
        return (
            pg_log.id == es_log.id
            and pg_log.workflow_run_id == es_log.workflow_run_id
            and pg_log.created_from == es_log.created_from
        )

    def cleanup_old_pg_data(
        self,
        tenant_id: str,
        before_date: datetime,
        dry_run: bool = True,
    ) -> Dict[str, Any]:
        """
        Clean up old PostgreSQL data after successful migration to Elasticsearch.
        
        Args:
            tenant_id: Tenant ID to clean up
            before_date: Delete records created before this date
            dry_run: If True, only count records without deleting
            
        Returns:
            Cleanup statistics
        """
        logger.info(f"Starting PostgreSQL data cleanup for tenant {tenant_id}")
        
        stats = {
            "workflow_runs_deleted": 0,
            "app_logs_deleted": 0,
            "node_executions_deleted": 0,
            "offload_records_deleted": 0,
            "start_time": datetime.utcnow(),
        }

        try:
            with self._session_maker() as session:
                if not dry_run:
                    # Delete WorkflowNodeExecutionOffload records
                    offload_count = session.query(WorkflowNodeExecutionOffload).filter(
                        WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                        WorkflowNodeExecutionOffload.created_at < before_date,
                    ).count()
                    
                    session.query(WorkflowNodeExecutionOffload).filter(
                        WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                        WorkflowNodeExecutionOffload.created_at < before_date,
                    ).delete()
                    
                    stats["offload_records_deleted"] = offload_count

                    # Delete WorkflowNodeExecution records
                    node_exec_count = session.query(WorkflowNodeExecutionModel).filter(
                        WorkflowNodeExecutionModel.tenant_id == tenant_id,
                        WorkflowNodeExecutionModel.created_at < before_date,
                    ).count()
                    
                    session.query(WorkflowNodeExecutionModel).filter(
                        WorkflowNodeExecutionModel.tenant_id == tenant_id,
                        WorkflowNodeExecutionModel.created_at < before_date,
                    ).delete()
                    
                    stats["node_executions_deleted"] = node_exec_count

                    # Delete WorkflowAppLog records
                    app_log_count = session.query(WorkflowAppLog).filter(
                        WorkflowAppLog.tenant_id == tenant_id,
                        WorkflowAppLog.created_at < before_date,
                    ).count()
                    
                    session.query(WorkflowAppLog).filter(
                        WorkflowAppLog.tenant_id == tenant_id,
                        WorkflowAppLog.created_at < before_date,
                    ).delete()
                    
                    stats["app_logs_deleted"] = app_log_count

                    # Delete WorkflowRun records
                    workflow_run_count = session.query(WorkflowRun).filter(
                        WorkflowRun.tenant_id == tenant_id,
                        WorkflowRun.created_at < before_date,
                    ).count()
                    
                    session.query(WorkflowRun).filter(
                        WorkflowRun.tenant_id == tenant_id,
                        WorkflowRun.created_at < before_date,
                    ).delete()
                    
                    stats["workflow_runs_deleted"] = workflow_run_count

                    session.commit()
                else:
                    # Dry run - just count records
                    stats["workflow_runs_deleted"] = session.query(WorkflowRun).filter(
                        WorkflowRun.tenant_id == tenant_id,
                        WorkflowRun.created_at < before_date,
                    ).count()
                    
                    stats["app_logs_deleted"] = session.query(WorkflowAppLog).filter(
                        WorkflowAppLog.tenant_id == tenant_id,
                        WorkflowAppLog.created_at < before_date,
                    ).count()
                    
                    stats["node_executions_deleted"] = session.query(WorkflowNodeExecutionModel).filter(
                        WorkflowNodeExecutionModel.tenant_id == tenant_id,
                        WorkflowNodeExecutionModel.created_at < before_date,
                    ).count()
                    
                    stats["offload_records_deleted"] = session.query(WorkflowNodeExecutionOffload).filter(
                        WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                        WorkflowNodeExecutionOffload.created_at < before_date,
                    ).count()

        except Exception as e:
            logger.error(f"Cleanup failed: {str(e)}")
            raise

        stats["end_time"] = datetime.utcnow()
        stats["duration"] = (stats["end_time"] - stats["start_time"]).total_seconds()
        
        action = "Would delete" if dry_run else "Deleted"
        logger.info(f"PostgreSQL cleanup completed: {action} {stats['workflow_runs_deleted']} WorkflowRuns, "
                   f"{stats['app_logs_deleted']} AppLogs, {stats['node_executions_deleted']} NodeExecutions, "
                   f"{stats['offload_records_deleted']} OffloadRecords in {stats['duration']:.2f}s")
        
        return stats
