from __future__ import annotations

"""
Workflow Performance Service

This service provides comprehensive performance tracking, analysis, and optimization
for workflow executions. It collects metrics, generates insights, and provides
actionable recommendations for improving workflow performance.
"""

import logging
<<<<<<< HEAD
from datetime import datetime, timedelta
from typing import Any, Optional
=======
from datetime import timedelta
from typing import Any
>>>>>>> 84fa5d33dcdd42d2fe53fedd665885197fba2c6c

from sqlalchemy import and_, case, desc, func, select

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.workflow_performance import (
    OptimizationCategory,
    OptimizationSeverity,
    WorkflowNodePerformance,
    WorkflowOptimizationRecommendation,
    WorkflowPerformanceMetrics,
)

logger = logging.getLogger(__name__)


class WorkflowPerformanceService:
    """
    Service for tracking and analyzing workflow performance.

    This service provides methods for:
    - Recording performance metrics
    - Analyzing execution patterns
    - Generating optimization recommendations
    - Managing performance trends
    """

    @staticmethod
    def record_workflow_execution(
        *,
        app_id: str,
        workflow_id: str,
        workflow_run_id: str,
        total_execution_time: float,
        node_count: int,
        successful_nodes: int,
        failed_nodes: int,
        cached_nodes: int,
        total_tokens_used: int | None = None,
        total_tokens_cost: float | None = None,
        peak_memory_mb: float | None = None,
        avg_node_execution_time: float = 0.0,
        slowest_node_id: str | None = None,
        slowest_node_time: float | None = None,
        cache_hit_rate: float = 0.0,
        execution_status: str = "succeeded",
        error_message: str | None = None,
        extra_info: dict[str, Any] | None = None,
    ) -> WorkflowPerformanceMetrics:
        """
        Record performance metrics for a workflow execution.

        Args:
            app_id: Application ID
            workflow_id: Workflow ID
            workflow_run_id: Unique workflow run ID
            total_execution_time: Total execution time in seconds
            node_count: Number of nodes executed
            successful_nodes: Number of successfully executed nodes
            failed_nodes: Number of failed nodes
            cached_nodes: Number of nodes served from cache
            total_tokens_used: Total LLM tokens consumed
            total_tokens_cost: Estimated cost in USD
            peak_memory_mb: Peak memory usage in MB
            avg_node_execution_time: Average node execution time
            slowest_node_id: ID of the slowest node
            slowest_node_time: Execution time of slowest node
            cache_hit_rate: Percentage of cache hits (0-100)
            execution_status: Status of execution (succeeded, failed, partial)
            error_message: Error message if failed
            extra_info: Additional metadata

        Returns:
            Created WorkflowPerformanceMetrics instance
        """
        metrics = WorkflowPerformanceMetrics(
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            total_execution_time=total_execution_time,
            node_count=node_count,
            successful_nodes=successful_nodes,
            failed_nodes=failed_nodes,
            cached_nodes=cached_nodes,
            total_tokens_used=total_tokens_used,
            total_tokens_cost=total_tokens_cost,
            peak_memory_mb=peak_memory_mb,
            avg_node_execution_time=avg_node_execution_time,
            slowest_node_id=slowest_node_id,
            slowest_node_time=slowest_node_time,
            cache_hit_rate=cache_hit_rate,
            execution_status=execution_status,
            error_message=error_message,
            extra_info=extra_info or {},
        )

        db.session.add(metrics)
        db.session.commit()

        logger.info(
            "Recorded workflow performance metrics for run %s: %.2fs, %s nodes, %.1f%% cache hit rate",
            workflow_run_id,
            total_execution_time,
            node_count,
            cache_hit_rate,
        )

        return metrics

    @staticmethod
    def record_node_execution(
        *,
        workflow_run_id: str,
        node_id: str,
        node_execution_id: str,
        node_type: str,
        node_title: str | None,
        execution_time: float,
        start_time: datetime,
        end_time: datetime,
        tokens_used: int | None = None,
        tokens_cost: float | None = None,
        memory_used_mb: float | None = None,
        is_cached: bool = False,
        cache_key: str | None = None,
        retry_count: int = 0,
        status: str = "succeeded",
        error_message: str | None = None,
        input_size_bytes: int | None = None,
        output_size_bytes: int | None = None,
        extra_info: dict[str, Any] | None = None,
    ) -> WorkflowNodePerformance:
        """
        Record performance metrics for a single node execution.

        Args:
            workflow_run_id: Workflow run ID
            node_id: Node ID
            node_execution_id: Unique node execution ID
            node_type: Type of node
            node_title: Display title of node
            execution_time: Execution time in seconds
            start_time: Execution start time
            end_time: Execution end time
            tokens_used: LLM tokens consumed
            tokens_cost: Estimated cost in USD
            memory_used_mb: Memory used in MB
            is_cached: Whether result was served from cache
            cache_key: Cache key if cached
            retry_count: Number of retries
            status: Execution status
            error_message: Error message if failed
            input_size_bytes: Size of input data
            output_size_bytes: Size of output data
            extra_info: Additional metadata

        Returns:
            Created WorkflowNodePerformance instance
        """
        node_perf = WorkflowNodePerformance(
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
            node_type=node_type,
            node_title=node_title,
            execution_time=execution_time,
            start_time=start_time,
            end_time=end_time,
            tokens_used=tokens_used,
            tokens_cost=tokens_cost,
            memory_used_mb=memory_used_mb,
            is_cached=is_cached,
            cache_key=cache_key,
            retry_count=retry_count,
            status=status,
            error_message=error_message,
            input_size_bytes=input_size_bytes,
            output_size_bytes=output_size_bytes,
            extra_info=extra_info or {},
        )

        db.session.add(node_perf)
        db.session.commit()

        return node_perf

    @staticmethod
    def get_workflow_performance_summary(
        workflow_id: str,
        days: int = 7,
    ) -> dict[str, Any]:
        """
        Get performance summary for a workflow over a time period.

        Args:
            workflow_id: Workflow ID
            days: Number of days to analyze

        Returns:
            Dictionary containing performance summary
        """
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Query performance metrics
        stmt = select(
            func.count(WorkflowPerformanceMetrics.id).label("total_runs"),
            func.avg(WorkflowPerformanceMetrics.total_execution_time).label("avg_execution_time"),
            func.min(WorkflowPerformanceMetrics.total_execution_time).label("min_execution_time"),
            func.max(WorkflowPerformanceMetrics.total_execution_time).label("max_execution_time"),
            func.avg(WorkflowPerformanceMetrics.cache_hit_rate).label("avg_cache_hit_rate"),
            func.sum(WorkflowPerformanceMetrics.total_tokens_used).label("total_tokens"),
            func.sum(WorkflowPerformanceMetrics.total_tokens_cost).label("total_cost"),
            func.sum(case((WorkflowPerformanceMetrics.execution_status == "succeeded", 1), else_=0)).label(
                "successful_runs"
            ),
            func.sum(case((WorkflowPerformanceMetrics.execution_status == "failed", 1), else_=0)).label("failed_runs"),
        ).where(
            and_(
                WorkflowPerformanceMetrics.workflow_id == workflow_id,
                WorkflowPerformanceMetrics.created_at >= cutoff_date,
            )
        )

        result = db.session.execute(stmt).first()

        if not result or result.total_runs == 0:
            return {
                "total_runs": 0,
                "avg_execution_time": 0.0,
                "min_execution_time": 0.0,
                "max_execution_time": 0.0,
                "avg_cache_hit_rate": 0.0,
                "total_tokens": 0,
                "total_cost": 0.0,
                "success_rate": 0.0,
                "error_rate": 0.0,
            }

        success_rate = (result.successful_runs / result.total_runs * 100) if result.total_runs > 0 else 0.0
        error_rate = (result.failed_runs / result.total_runs * 100) if result.total_runs > 0 else 0.0

        return {
            "total_runs": result.total_runs,
            "avg_execution_time": float(result.avg_execution_time or 0.0),
            "min_execution_time": float(result.min_execution_time or 0.0),
            "max_execution_time": float(result.max_execution_time or 0.0),
            "avg_cache_hit_rate": float(result.avg_cache_hit_rate or 0.0),
            "total_tokens": int(result.total_tokens or 0),
            "total_cost": float(result.total_cost or 0.0),
            "success_rate": success_rate,
            "error_rate": error_rate,
        }

    @staticmethod
    def get_node_performance_breakdown(
        workflow_id: str,
        days: int = 7,
    ) -> list[dict[str, Any]]:
        """
        Get performance breakdown by node type for a workflow.

        Args:
            workflow_id: Workflow ID
            days: Number of days to analyze

        Returns:
            List of node performance summaries
        """
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Use JOIN to filter nodes in a single query
        stmt = (
            select(
                WorkflowNodePerformance.node_type,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.avg(WorkflowNodePerformance.execution_time).label("avg_execution_time"),
                func.min(WorkflowNodePerformance.execution_time).label("min_execution_time"),
                func.max(WorkflowNodePerformance.execution_time).label("max_execution_time"),
                func.sum(WorkflowNodePerformance.tokens_used).label("total_tokens"),
                func.sum(WorkflowNodePerformance.tokens_cost).label("total_cost"),
                func.sum(case((WorkflowNodePerformance.is_cached == True, 1), else_=0)).label("cache_hits"),
                func.sum(case((WorkflowNodePerformance.status == "failed", 1), else_=0)).label("failures"),
            )
            .join(
                WorkflowPerformanceMetrics,
                WorkflowNodePerformance.workflow_run_id == WorkflowPerformanceMetrics.workflow_run_id,
            )
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                )
            )
            .group_by(WorkflowNodePerformance.node_type)
            .order_by(desc("avg_execution_time"))
        )

        results = db.session.execute(stmt).fetchall()

        breakdown = []
        for row in results:
            cache_hit_rate = (row.cache_hits / row.execution_count * 100) if row.execution_count > 0 else 0.0
            failure_rate = (row.failures / row.execution_count * 100) if row.execution_count > 0 else 0.0

            breakdown.append(
                {
                    "node_type": row.node_type,
                    "execution_count": row.execution_count,
                    "avg_execution_time": float(row.avg_execution_time or 0.0),
                    "min_execution_time": float(row.min_execution_time or 0.0),
                    "max_execution_time": float(row.max_execution_time or 0.0),
                    "total_tokens": int(row.total_tokens or 0),
                    "total_cost": float(row.total_cost or 0.0),
                    "cache_hit_rate": cache_hit_rate,
                    "failure_rate": failure_rate,
                }
            )

        return breakdown

    @staticmethod
    def identify_bottlenecks(
        workflow_id: str,
        days: int = 7,
        threshold_percentile: float = 90.0,
    ) -> list[dict[str, Any]]:
        """
        Identify performance bottlenecks in a workflow.

        Args:
            workflow_id: Workflow ID
            days: Number of days to analyze
            threshold_percentile: Percentile threshold for identifying slow nodes

        Returns:
            List of identified bottlenecks
        """
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Use JOIN to filter nodes in a single query
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.avg(WorkflowNodePerformance.execution_time).label("avg_time"),
                func.max(WorkflowNodePerformance.execution_time).label("max_time"),
                func.stddev(WorkflowNodePerformance.execution_time).label("std_dev"),
            )
            .join(
                WorkflowPerformanceMetrics,
                WorkflowNodePerformance.workflow_run_id == WorkflowPerformanceMetrics.workflow_run_id,
            )
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                )
            )
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(func.count(WorkflowNodePerformance.id) >= 3)  # At least 3 executions
            .order_by(desc("avg_time"))
        )

        results = db.session.execute(stmt).fetchall()

        bottlenecks = []
        for row in results:
            # Calculate severity based on execution time and variability
            severity = "medium"
            if row.avg_time > 30.0:  # More than 30 seconds
                severity = "critical"
            elif row.avg_time > 10.0:  # More than 10 seconds
                severity = "high"

            bottlenecks.append(
                {
                    "node_id": row.node_id,
                    "node_type": row.node_type,
                    "node_title": row.node_title,
                    "execution_count": row.execution_count,
                    "avg_execution_time": float(row.avg_time or 0.0),
                    "max_execution_time": float(row.max_time or 0.0),
                    "std_deviation": float(row.std_dev or 0.0),
                    "severity": severity,
                }
            )

        return bottlenecks[:10]  # Return top 10 bottlenecks

    @staticmethod
    def create_optimization_recommendation(
        *,
        app_id: str,
        workflow_id: str,
        title: str,
        description: str,
        category: OptimizationCategory,
        severity: OptimizationSeverity,
        estimated_improvement: str | None = None,
        affected_nodes: list[str] | None = None,
        recommendation_steps: list[str],
        code_example: str | None = None,
        documentation_link: str | None = None,
        supporting_metrics: dict[str, Any] | None = None,
        sample_workflow_runs: list[str] | None = None,
        extra_info: dict[str, Any] | None = None,
    ) -> WorkflowOptimizationRecommendation:
        """
        Create an optimization recommendation for a workflow.

        Args:
            app_id: Application ID
            workflow_id: Workflow ID
            title: Recommendation title
            description: Detailed description
            category: Recommendation category
            severity: Severity level
            estimated_improvement: Estimated improvement description
            affected_nodes: List of affected node IDs
            recommendation_steps: List of actionable steps
            code_example: Example code
            documentation_link: Link to documentation
            supporting_metrics: Supporting performance metrics
            sample_workflow_runs: Sample workflow run IDs
            extra_info: Additional metadata

        Returns:
            Created WorkflowOptimizationRecommendation instance
        """
        recommendation = WorkflowOptimizationRecommendation(
            app_id=app_id,
            workflow_id=workflow_id,
            title=title,
            description=description,
            category=category.value,
            severity=severity.value,
            estimated_improvement=estimated_improvement,
            affected_nodes=affected_nodes or [],
            recommendation_steps=recommendation_steps,
            code_example=code_example,
            documentation_link=documentation_link,
            supporting_metrics=supporting_metrics or {},
            sample_workflow_runs=sample_workflow_runs or [],
            status="active",
            extra_info=extra_info or {},
        )

        db.session.add(recommendation)
        db.session.commit()

        logger.info(
            "Created optimization recommendation for workflow %s: %s (severity: %s)",
            workflow_id,
            title,
            severity.value,
        )

        return recommendation

    @staticmethod
    def get_active_recommendations(
        workflow_id: str,
        severity: OptimizationSeverity | None = None,
        category: OptimizationCategory | None = None,
    ) -> list[WorkflowOptimizationRecommendation]:
        """
        Get active optimization recommendations for a workflow.

        Args:
            workflow_id: Workflow ID
            severity: Filter by severity level
            category: Filter by category

        Returns:
            List of active recommendations
        """
        filters = [
            WorkflowOptimizationRecommendation.workflow_id == workflow_id,
            WorkflowOptimizationRecommendation.status == "active",
        ]

        if severity:
            filters.append(WorkflowOptimizationRecommendation.severity == severity.value)

        if category:
            filters.append(WorkflowOptimizationRecommendation.category == category.value)

        stmt = (
            select(WorkflowOptimizationRecommendation)
            .where(and_(*filters))
            .order_by(
                # Order by severity: critical > high > medium > low > info
                case(
                    (WorkflowOptimizationRecommendation.severity == "critical", 1),
                    (WorkflowOptimizationRecommendation.severity == "high", 2),
                    (WorkflowOptimizationRecommendation.severity == "medium", 3),
                    (WorkflowOptimizationRecommendation.severity == "low", 4),
                    else_=5,
                ),
                desc(WorkflowOptimizationRecommendation.created_at),
            )
        )

        return list(db.session.execute(stmt).scalars().all())

    @staticmethod
    def dismiss_recommendation(
        recommendation_id: str,
        dismissed_by: str,
        reason: str | None = None,
    ) -> WorkflowOptimizationRecommendation:
        """
        Dismiss an optimization recommendation.

        Args:
            recommendation_id: Recommendation ID
            dismissed_by: User ID who dismissed
            reason: Reason for dismissal

        Returns:
            Updated recommendation
        """
        recommendation = db.session.get(WorkflowOptimizationRecommendation, recommendation_id)

        if not recommendation:
            raise ValueError(f"Recommendation {recommendation_id} not found")

        recommendation.status = "dismissed"
        recommendation.dismissed_by = dismissed_by
        recommendation.dismissed_at = naive_utc_now()
        recommendation.dismissed_reason = reason

        db.session.commit()

        return recommendation
