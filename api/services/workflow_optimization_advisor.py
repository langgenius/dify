"""
Workflow Optimization Advisor

This service analyzes workflow execution patterns and generates AI-powered
optimization recommendations across multiple categories.
"""

import logging
from datetime import timedelta

from sqlalchemy import and_, case, func, select

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.workflow_performance import (
    OptimizationCategory,
    OptimizationSeverity,
    WorkflowNodePerformance,
    WorkflowOptimizationRecommendation,
    WorkflowPerformanceMetrics,
)
from services.workflow_performance_service import WorkflowPerformanceService

logger = logging.getLogger(__name__)


class WorkflowOptimizationAdvisor:
    """Service for analyzing workflows and generating optimization recommendations."""

    @staticmethod
    def analyze_and_recommend(
        app_id: str,
        workflow_id: str,
        days: int = 7,
    ) -> list[WorkflowOptimizationRecommendation]:
        """
        Analyze a workflow and generate optimization recommendations.

        Args:
            app_id: Application ID
            workflow_id: Workflow ID
            days: Number of days to analyze

        Returns:
            List of generated recommendations
        """
        recommendations = []

        # Run various analysis methods
        recommendations.extend(WorkflowOptimizationAdvisor._analyze_cache_opportunities(app_id, workflow_id, days))
        recommendations.extend(WorkflowOptimizationAdvisor._analyze_error_patterns(app_id, workflow_id, days))
        recommendations.extend(WorkflowOptimizationAdvisor._analyze_token_usage(app_id, workflow_id, days))
        recommendations.extend(WorkflowOptimizationAdvisor._analyze_parallel_opportunities(app_id, workflow_id, days))
        recommendations.extend(WorkflowOptimizationAdvisor._analyze_retry_patterns(app_id, workflow_id, days))

        logger.info(
            "Generated %d optimization recommendations for workflow_id=%s",
            len(recommendations),
            workflow_id,
        )

        return recommendations

    @staticmethod
    def _analyze_cache_opportunities(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Identify nodes that could benefit from caching."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Use JOIN to filter nodes in a single query
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.avg(WorkflowNodePerformance.execution_time).label("avg_time"),
                func.sum(case((WorkflowNodePerformance.is_cached == True, 1), else_=0)).label("cache_hits"),
            )
            .join(
                WorkflowPerformanceMetrics,
                WorkflowNodePerformance.workflow_run_id == WorkflowPerformanceMetrics.workflow_run_id,
            )
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                    WorkflowNodePerformance.node_type.in_(["llm", "code", "knowledge_retrieval"]),
                )
            )
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(
                and_(
                    func.count(WorkflowNodePerformance.id) >= 5,  # At least 5 executions
                    func.avg(WorkflowNodePerformance.execution_time) > 2.0,  # Avg time > 2s
                )
            )
        )

        results = db.session.execute(stmt).fetchall()

        for row in results:
            cache_rate = (row.cache_hits / row.execution_count * 100) if row.execution_count > 0 else 0.0

            if cache_rate < 50:  # Less than 50% cache hit rate
                potential_savings = row.avg_time * row.execution_count * (1 - cache_rate / 100)

                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"Enable caching for {row.node_type} node: {row.node_title or row.node_id}",
                    description=f"This {row.node_type} node has been executed {row.execution_count} times "
                    f"with an average execution time of {row.avg_time:.2f}s, but only {cache_rate:.1f}% "
                    f"of executions use cached results. Enabling caching could save approximately "
                    f"{potential_savings:.1f}s over the analyzed period.",
                    category=OptimizationCategory.PERFORMANCE,
                    severity=OptimizationSeverity.HIGH if row.avg_time > 5.0 else OptimizationSeverity.MEDIUM,
                    estimated_improvement=f"{int((1 - cache_rate / 100) * 100)}% faster execution",
                    affected_nodes=[row.node_id],
                    recommendation_steps=[
                        "Review node configuration to ensure deterministic behavior",
                        "Enable caching in node settings",
                        "Configure appropriate TTL based on data freshness requirements",
                        "Monitor cache hit rate after implementation",
                    ],
                    supporting_metrics={
                        "execution_count": row.execution_count,
                        "avg_execution_time": float(row.avg_time),
                        "current_cache_rate": cache_rate,
                        "potential_time_savings": potential_savings,
                    },
                )
                recommendations.append(recommendation)

        return recommendations

    @staticmethod
    def _analyze_error_patterns(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Identify nodes with high error rates."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Use JOIN to filter nodes in a single query
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("total_executions"),
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
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(func.count(WorkflowNodePerformance.id) >= 5)
        )

        results = db.session.execute(stmt).fetchall()

        for row in results:
            failure_rate = (row.failures / row.total_executions * 100) if row.total_executions > 0 else 0.0

            if failure_rate > 10:  # More than 10% failure rate
                severity = OptimizationSeverity.CRITICAL if failure_rate > 30 else OptimizationSeverity.HIGH

                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"High failure rate in {row.node_type} node: {row.node_title or row.node_id}",
                    description=f"This node has a {failure_rate:.1f}% failure rate "
                    f"({row.failures} failures out of {row.total_executions} executions). "
                    f"This impacts workflow reliability and user experience.",
                    category=OptimizationCategory.RELIABILITY,
                    severity=severity,
                    estimated_improvement=f"Reduce failures by {int(failure_rate)}%",
                    affected_nodes=[row.node_id],
                    recommendation_steps=[
                        "Review error logs to identify common failure patterns",
                        "Add input validation to prevent invalid data",
                        "Implement retry logic with exponential backoff",
                        "Add error handling and fallback mechanisms",
                        "Consider timeout adjustments if failures are timeout-related",
                    ],
                    supporting_metrics={
                        "total_executions": row.total_executions,
                        "failures": row.failures,
                        "failure_rate": failure_rate,
                    },
                )
                recommendations.append(recommendation)

        return recommendations

    @staticmethod
    def _analyze_token_usage(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Identify opportunities to reduce token usage and costs."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Use JOIN to filter nodes in a single query
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.sum(WorkflowNodePerformance.tokens_used).label("total_tokens"),
                func.avg(WorkflowNodePerformance.tokens_used).label("avg_tokens"),
                func.sum(WorkflowNodePerformance.tokens_cost).label("total_cost"),
            )
            .join(
                WorkflowPerformanceMetrics,
                WorkflowNodePerformance.workflow_run_id == WorkflowPerformanceMetrics.workflow_run_id,
            )
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                    WorkflowNodePerformance.node_type == "llm",
                    WorkflowNodePerformance.tokens_used.isnot(None),
                )
            )
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(func.avg(WorkflowNodePerformance.tokens_used) > 2000)  # High token usage
        )

        results = db.session.execute(stmt).fetchall()

        for row in results:
            potential_savings = row.total_cost * 0.3 if row.total_cost else 0  # Estimate 30% reduction

            recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                app_id=app_id,
                workflow_id=workflow_id,
                title=f"Optimize token usage in LLM node: {row.node_title or row.node_id}",
                description=f"This LLM node uses an average of {int(row.avg_tokens)} tokens per execution, "
                f"with a total of {int(row.total_tokens)} tokens across {row.execution_count} executions. "
                f"Total cost: ${row.total_cost:.2f}. Optimizing prompts could reduce costs significantly.",
                category=OptimizationCategory.COST,
                severity=OptimizationSeverity.MEDIUM if row.total_cost > 1.0 else OptimizationSeverity.LOW,
                estimated_improvement=f"Save ~${potential_savings:.2f} ({30}% cost reduction)",
                affected_nodes=[row.node_id],
                recommendation_steps=[
                    "Review and optimize system prompts to be more concise",
                    "Remove unnecessary context from prompts",
                    "Use prompt templates to avoid repetition",
                    "Consider using a smaller model for simpler tasks",
                    "Implement prompt caching where applicable",
                ],
                supporting_metrics={
                    "execution_count": row.execution_count,
                    "total_tokens": int(row.total_tokens),
                    "avg_tokens": float(row.avg_tokens),
                    "total_cost": float(row.total_cost or 0),
                    "potential_savings": potential_savings,
                },
            )
            recommendations.append(recommendation)

        return recommendations

    @staticmethod
    def _analyze_parallel_opportunities(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Identify opportunities for parallel execution."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Get workflow metrics to analyze sequential execution patterns
        stmt = (
            select(WorkflowPerformanceMetrics)
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                    WorkflowPerformanceMetrics.node_count >= 5,  # At least 5 nodes
                )
            )
            .limit(10)
        )

        results = db.session.execute(stmt).scalars().all()

        if len(results) >= 3:  # Need sufficient data
            avg_total_time = sum(r.total_execution_time for r in results) / len(results)
            avg_node_time = sum(r.avg_node_execution_time for r in results) / len(results)
            avg_node_count = sum(r.node_count for r in results) / len(results)

            # If total time is close to sum of node times, likely sequential
            if avg_total_time > (avg_node_time * avg_node_count * 0.8):
                potential_speedup = avg_total_time * 0.4  # Estimate 40% speedup

                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title="Consider parallelizing independent workflow nodes",
                    description=f"Analysis suggests this workflow executes nodes primarily in sequence. "
                    f"Average total execution time is {avg_total_time:.2f}s across {int(avg_node_count)} nodes. "
                    f"Parallelizing independent nodes could significantly reduce execution time.",
                    category=OptimizationCategory.PARALLELIZATION,
                    severity=OptimizationSeverity.MEDIUM,
                    estimated_improvement=f"~{40}% faster execution",
                    affected_nodes=[],
                    recommendation_steps=[
                        "Identify nodes that don't depend on each other's outputs",
                        "Group independent nodes for parallel execution",
                        "Use parallel execution blocks in workflow configuration",
                        "Test thoroughly to ensure no hidden dependencies",
                        "Monitor for race conditions or resource contention",
                    ],
                    supporting_metrics={
                        "avg_total_time": avg_total_time,
                        "avg_node_time": avg_node_time,
                        "avg_node_count": avg_node_count,
                        "potential_speedup": potential_speedup,
                    },
                )
                recommendations.append(recommendation)

        return recommendations

    @staticmethod
    def _analyze_retry_patterns(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Identify nodes with excessive retries."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Use JOIN to filter nodes in a single query
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.avg(WorkflowNodePerformance.retry_count).label("avg_retries"),
                func.max(WorkflowNodePerformance.retry_count).label("max_retries"),
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
            .having(func.avg(WorkflowNodePerformance.retry_count) > 0.5)  # Avg > 0.5 retries
        )

        results = db.session.execute(stmt).fetchall()

        for row in results:
            recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                app_id=app_id,
                workflow_id=workflow_id,
                title=f"Excessive retries in {row.node_type} node: {row.node_title or row.node_id}",
                description=f"This node averages {row.avg_retries:.1f} retries per execution "
                f"(max: {row.max_retries}). Frequent retries indicate reliability issues that should be addressed.",
                category=OptimizationCategory.RELIABILITY,
                severity=OptimizationSeverity.HIGH if row.avg_retries > 2 else OptimizationSeverity.MEDIUM,
                estimated_improvement="Reduce retry overhead and improve reliability",
                affected_nodes=[row.node_id],
                recommendation_steps=[
                    "Investigate root cause of failures requiring retries",
                    "Improve error handling to fail fast on non-retryable errors",
                    "Adjust timeout settings if retries are timeout-related",
                    "Implement circuit breaker pattern for external services",
                    "Add monitoring alerts for high retry rates",
                ],
                supporting_metrics={
                    "execution_count": row.execution_count,
                    "avg_retries": float(row.avg_retries),
                    "max_retries": row.max_retries,
                },
            )
            recommendations.append(recommendation)

        return recommendations
