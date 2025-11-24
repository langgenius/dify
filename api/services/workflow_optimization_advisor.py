"""
Workflow Optimization Advisor Service

This service analyzes workflow performance data and generates AI-powered
optimization recommendations to improve performance, reduce costs, and
enhance reliability.
"""

import logging
from collections import defaultdict
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import and_, desc, func, select

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
    """
    Service for generating intelligent optimization recommendations.
    
    This service analyzes workflow execution patterns and generates
    actionable recommendations to improve performance and efficiency.
    """

    @staticmethod
    def analyze_and_recommend(
        app_id: str,
        workflow_id: str,
        days: int = 7,
    ) -> list[WorkflowOptimizationRecommendation]:
        """
        Analyze workflow performance and generate optimization recommendations.
        
        Args:
            app_id: Application ID
            workflow_id: Workflow ID
            days: Number of days to analyze
            
        Returns:
            List of generated recommendations
        """
        recommendations = []
        
        # Run various analysis strategies
        recommendations.extend(
            WorkflowOptimizationAdvisor._analyze_slow_nodes(app_id, workflow_id, days)
        )
        recommendations.extend(
            WorkflowOptimizationAdvisor._analyze_cache_opportunities(app_id, workflow_id, days)
        )
        recommendations.extend(
            WorkflowOptimizationAdvisor._analyze_error_patterns(app_id, workflow_id, days)
        )
        recommendations.extend(
            WorkflowOptimizationAdvisor._analyze_token_usage(app_id, workflow_id, days)
        )
        recommendations.extend(
            WorkflowOptimizationAdvisor._analyze_parallel_opportunities(app_id, workflow_id, days)
        )
        recommendations.extend(
            WorkflowOptimizationAdvisor._analyze_retry_patterns(app_id, workflow_id, days)
        )
        
        logger.info(
            f"Generated {len(recommendations)} optimization recommendations "
            f"for workflow {workflow_id}"
        )
        
        return recommendations

    @staticmethod
    def _analyze_slow_nodes(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Analyze and recommend optimizations for slow nodes."""
        recommendations = []
        bottlenecks = WorkflowPerformanceService.identify_bottlenecks(
            workflow_id=workflow_id,
            days=days,
        )
        
        for bottleneck in bottlenecks[:5]:  # Top 5 bottlenecks
            if bottleneck["avg_execution_time"] > 5.0:  # More than 5 seconds
                severity = OptimizationSeverity.HIGH
                if bottleneck["avg_execution_time"] > 30.0:
                    severity = OptimizationSeverity.CRITICAL
                
                node_type = bottleneck["node_type"]
                node_title = bottleneck["node_title"] or bottleneck["node_id"]
                
                # Generate specific recommendations based on node type
                steps = []
                code_example = None
                
                if node_type == "llm":
                    steps = [
                        "Consider using a faster model variant (e.g., GPT-3.5 instead of GPT-4)",
                        "Reduce the max_tokens parameter to limit response length",
                        "Optimize your prompt to be more concise and specific",
                        "Enable streaming for better perceived performance",
                        "Consider caching LLM responses for repeated queries",
                    ]
                    code_example = """
# Optimize LLM configuration
{
  "model": "gpt-3.5-turbo",  // Faster than GPT-4
  "max_tokens": 500,  // Limit response length
  "temperature": 0.7,
  "stream": true  // Enable streaming
}
"""
                elif node_type == "http_request":
                    steps = [
                        "Add timeout configuration to prevent hanging requests",
                        "Implement request caching for frequently accessed endpoints",
                        "Consider using a faster API endpoint if available",
                        "Add retry logic with exponential backoff",
                        "Optimize payload size to reduce transfer time",
                    ]
                    code_example = """
# Optimize HTTP request configuration
{
  "timeout": 10,  // 10 second timeout
  "cache_ttl": 3600,  // Cache for 1 hour
  "retry_count": 3,
  "retry_delay": 1000  // 1 second initial delay
}
"""
                elif node_type == "code":
                    steps = [
                        "Review code for inefficient algorithms or loops",
                        "Consider using built-in functions instead of custom implementations",
                        "Optimize data structures for better performance",
                        "Add early returns to avoid unnecessary processing",
                        "Profile the code to identify specific bottlenecks",
                    ]
                else:
                    steps = [
                        f"Review the {node_type} node configuration for optimization opportunities",
                        "Consider breaking down complex operations into smaller steps",
                        "Enable caching if the node produces deterministic results",
                        "Add timeout limits to prevent hanging executions",
                    ]
                
                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"Optimize slow {node_type} node: {node_title}",
                    description=(
                        f"The '{node_title}' node has an average execution time of "
                        f"{bottleneck['avg_execution_time']:.2f} seconds, which is significantly "
                        f"slower than optimal. This node is a performance bottleneck and should be optimized."
                    ),
                    category=OptimizationCategory.PERFORMANCE,
                    severity=severity,
                    estimated_improvement=f"{int((bottleneck['avg_execution_time'] - 1.0) / bottleneck['avg_execution_time'] * 100)}% faster execution",
                    affected_nodes=[bottleneck["node_id"]],
                    recommendation_steps=steps,
                    code_example=code_example,
                    supporting_metrics={
                        "avg_execution_time": bottleneck["avg_execution_time"],
                        "max_execution_time": bottleneck["max_execution_time"],
                        "std_deviation": bottleneck["std_deviation"],
                        "execution_count": bottleneck["execution_count"],
                    },
                )
                recommendations.append(recommendation)
        
        return recommendations

    @staticmethod
    def _analyze_cache_opportunities(
        app_id: str,
        workflow_id: str,
        days: int,
    ) -> list[WorkflowOptimizationRecommendation]:
        """Analyze and recommend caching opportunities."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)
        
        # Get workflow run IDs
        run_ids_stmt = (
            select(WorkflowPerformanceMetrics.workflow_run_id)
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                )
            )
        )
        
        run_ids = [row[0] for row in db.session.execute(run_ids_stmt).fetchall()]
        
        if not run_ids:
            return recommendations
        
        # Find nodes with low cache hit rates but high execution times
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.avg(WorkflowNodePerformance.execution_time).label("avg_time"),
                func.sum(
                    func.case(
                        (WorkflowNodePerformance.is_cached == True, 1),
                        else_=0
                    )
                ).label("cache_hits"),
            )
            .where(WorkflowNodePerformance.workflow_run_id.in_(run_ids))
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(
                and_(
                    func.count(WorkflowNodePerformance.id) >= 5,  # At least 5 executions
                    func.avg(WorkflowNodePerformance.execution_time) > 2.0,  # Avg > 2 seconds
                )
            )
        )
        
        results = db.session.execute(stmt).fetchall()
        
        for row in results:
            cache_hit_rate = (row.cache_hits / row.execution_count * 100) if row.execution_count > 0 else 0.0
            
            if cache_hit_rate < 50.0:  # Less than 50% cache hit rate
                potential_time_saved = row.avg_time * row.execution_count * (1 - cache_hit_rate / 100) * 0.9
                
                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"Enable caching for {row.node_type} node: {row.node_title or row.node_id}",
                    description=(
                        f"The '{row.node_title or row.node_id}' node has a low cache hit rate of "
                        f"{cache_hit_rate:.1f}% despite being executed {row.execution_count} times. "
                        f"Enabling or improving caching could significantly reduce execution time."
                    ),
                    category=OptimizationCategory.PERFORMANCE,
                    severity=OptimizationSeverity.MEDIUM,
                    estimated_improvement=f"Save approximately {potential_time_saved:.1f} seconds over {days} days",
                    affected_nodes=[row.node_id],
                    recommendation_steps=[
                        "Enable result caching for this node",
                        "Configure an appropriate cache TTL based on data freshness requirements",
                        "Ensure the node produces deterministic results for the same inputs",
                        "Monitor cache hit rate after implementation",
                    ],
                    code_example="""
# Enable caching in node configuration
{
  "enable_cache": true,
  "cache_ttl_hours": 24,  // Cache for 24 hours
  "cache_key_fields": ["input_field1", "input_field2"]  // Fields to include in cache key
}
""",
                    supporting_metrics={
                        "current_cache_hit_rate": cache_hit_rate,
                        "execution_count": row.execution_count,
                        "avg_execution_time": float(row.avg_time),
                        "potential_time_saved": potential_time_saved,
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
        """Analyze and recommend fixes for error patterns."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)
        
        # Get workflow run IDs
        run_ids_stmt = (
            select(WorkflowPerformanceMetrics.workflow_run_id)
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                )
            )
        )
        
        run_ids = [row[0] for row in db.session.execute(run_ids_stmt).fetchall()]
        
        if not run_ids:
            return recommendations
        
        # Find nodes with high failure rates
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.sum(
                    func.case(
                        (WorkflowNodePerformance.status == "failed", 1),
                        else_=0
                    )
                ).label("failures"),
            )
            .where(WorkflowNodePerformance.workflow_run_id.in_(run_ids))
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(func.count(WorkflowNodePerformance.id) >= 3)
        )
        
        results = db.session.execute(stmt).fetchall()
        
        for row in results:
            failure_rate = (row.failures / row.execution_count * 100) if row.execution_count > 0 else 0.0
            
            if failure_rate > 10.0:  # More than 10% failure rate
                severity = OptimizationSeverity.MEDIUM
                if failure_rate > 30.0:
                    severity = OptimizationSeverity.HIGH
                if failure_rate > 50.0:
                    severity = OptimizationSeverity.CRITICAL
                
                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"Fix high error rate in {row.node_type} node: {row.node_title or row.node_id}",
                    description=(
                        f"The '{row.node_title or row.node_id}' node has a failure rate of "
                        f"{failure_rate:.1f}% ({row.failures} failures out of {row.execution_count} executions). "
                        f"This indicates a reliability issue that should be addressed."
                    ),
                    category=OptimizationCategory.RELIABILITY,
                    severity=severity,
                    estimated_improvement=f"Reduce error rate by {int(failure_rate * 0.8)}%",
                    affected_nodes=[row.node_id],
                    recommendation_steps=[
                        "Review error logs to identify common failure patterns",
                        "Add input validation to catch invalid data early",
                        "Implement proper error handling and fallback logic",
                        "Add retry logic with exponential backoff for transient failures",
                        "Consider adding a timeout to prevent hanging executions",
                        "Add monitoring and alerting for this node",
                    ],
                    code_example="""
# Add robust error handling
{
  "retry_count": 3,
  "retry_delay_ms": 1000,
  "timeout_seconds": 30,
  "fallback_value": null,  // Return null on failure instead of crashing
  "error_handling": "continue"  // Continue workflow on error
}
""",
                    supporting_metrics={
                        "failure_rate": failure_rate,
                        "total_failures": row.failures,
                        "execution_count": row.execution_count,
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
        """Analyze and recommend optimizations for token usage and costs."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)
        
        # Get workflow run IDs
        run_ids_stmt = (
            select(WorkflowPerformanceMetrics.workflow_run_id)
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                )
            )
        )
        
        run_ids = [row[0] for row in db.session.execute(run_ids_stmt).fetchall()]
        
        if not run_ids:
            return recommendations
        
        # Find LLM nodes with high token usage
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.sum(WorkflowNodePerformance.tokens_used).label("total_tokens"),
                func.avg(WorkflowNodePerformance.tokens_used).label("avg_tokens"),
                func.sum(WorkflowNodePerformance.tokens_cost).label("total_cost"),
            )
            .where(
                and_(
                    WorkflowNodePerformance.workflow_run_id.in_(run_ids),
                    WorkflowNodePerformance.node_type == "llm",
                    WorkflowNodePerformance.tokens_used.isnot(None),
                )
            )
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_title,
            )
            .having(func.avg(WorkflowNodePerformance.tokens_used) > 1000)  # Avg > 1000 tokens
        )
        
        results = db.session.execute(stmt).fetchall()
        
        for row in results:
            if row.avg_tokens > 2000:  # High token usage
                potential_savings = row.total_cost * 0.3 if row.total_cost else 0  # Estimate 30% savings
                
                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"Optimize token usage in LLM node: {row.node_title or row.node_id}",
                    description=(
                        f"The '{row.node_title or row.node_id}' LLM node uses an average of "
                        f"{row.avg_tokens:.0f} tokens per execution, which is quite high. "
                        f"Total cost over {days} days: ${row.total_cost:.2f}. "
                        f"Optimizing prompts and responses could significantly reduce costs."
                    ),
                    category=OptimizationCategory.COST,
                    severity=OptimizationSeverity.MEDIUM,
                    estimated_improvement=f"Save approximately ${potential_savings:.2f} over {days} days",
                    affected_nodes=[row.node_id],
                    recommendation_steps=[
                        "Optimize prompts to be more concise while maintaining effectiveness",
                        "Reduce max_tokens parameter to limit response length",
                        "Consider using a more cost-effective model if appropriate",
                        "Implement response caching for repeated queries",
                        "Use system messages efficiently to reduce token usage",
                        "Remove unnecessary context from prompts",
                    ],
                    code_example="""
# Optimize LLM configuration for cost
{
  "model": "gpt-3.5-turbo",  // More cost-effective
  "max_tokens": 500,  // Limit response length
  "temperature": 0.7,
  "presence_penalty": 0.1,  // Reduce repetition
  "frequency_penalty": 0.1
}
""",
                    supporting_metrics={
                        "avg_tokens_per_execution": float(row.avg_tokens),
                        "total_tokens": int(row.total_tokens or 0),
                        "total_cost": float(row.total_cost or 0.0),
                        "execution_count": row.execution_count,
                        "estimated_savings": potential_savings,
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
        """Analyze and recommend opportunities for parallel execution."""
        # This is a simplified analysis - in a real implementation,
        # you would analyze the workflow graph structure
        
        recommendations = []
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id,
            days=days,
        )
        
        if summary["total_runs"] < 5:
            return recommendations
        
        # If average execution time is high, suggest parallelization
        if summary["avg_execution_time"] > 15.0:
            recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                app_id=app_id,
                workflow_id=workflow_id,
                title="Consider parallelizing independent workflow nodes",
                description=(
                    f"The workflow has an average execution time of {summary['avg_execution_time']:.2f} seconds. "
                    f"Review the workflow structure to identify nodes that can be executed in parallel "
                    f"to reduce overall execution time."
                ),
                category=OptimizationCategory.PERFORMANCE,
                severity=OptimizationSeverity.MEDIUM,
                estimated_improvement="Potentially 20-40% faster execution",
                affected_nodes=[],
                recommendation_steps=[
                    "Analyze workflow graph to identify independent nodes",
                    "Group nodes that don't depend on each other's outputs",
                    "Configure parallel execution for independent node groups",
                    "Test thoroughly to ensure correctness",
                    "Monitor performance improvements",
                ],
                documentation_link="https://docs.dify.ai/guides/workflow/parallel-execution",
                supporting_metrics={
                    "avg_execution_time": summary["avg_execution_time"],
                    "total_runs": summary["total_runs"],
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
        """Analyze and recommend optimizations for retry patterns."""
        recommendations = []
        cutoff_date = naive_utc_now() - timedelta(days=days)
        
        # Get workflow run IDs
        run_ids_stmt = (
            select(WorkflowPerformanceMetrics.workflow_run_id)
            .where(
                and_(
                    WorkflowPerformanceMetrics.workflow_id == workflow_id,
                    WorkflowPerformanceMetrics.created_at >= cutoff_date,
                )
            )
        )
        
        run_ids = [row[0] for row in db.session.execute(run_ids_stmt).fetchall()]
        
        if not run_ids:
            return recommendations
        
        # Find nodes with high retry counts
        stmt = (
            select(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
                func.count(WorkflowNodePerformance.id).label("execution_count"),
                func.avg(WorkflowNodePerformance.retry_count).label("avg_retries"),
                func.sum(WorkflowNodePerformance.retry_count).label("total_retries"),
            )
            .where(WorkflowNodePerformance.workflow_run_id.in_(run_ids))
            .group_by(
                WorkflowNodePerformance.node_id,
                WorkflowNodePerformance.node_type,
                WorkflowNodePerformance.node_title,
            )
            .having(func.avg(WorkflowNodePerformance.retry_count) > 0.5)  # Avg > 0.5 retries
        )
        
        results = db.session.execute(stmt).fetchall()
        
        for row in results:
            if row.avg_retries > 1.0:  # Frequent retries
                recommendation = WorkflowPerformanceService.create_optimization_recommendation(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    title=f"Optimize retry logic for {row.node_type} node: {row.node_title or row.node_id}",
                    description=(
                        f"The '{row.node_title or row.node_id}' node has an average of "
                        f"{row.avg_retries:.1f} retries per execution, indicating potential "
                        f"reliability issues or suboptimal retry configuration."
                    ),
                    category=OptimizationCategory.RELIABILITY,
                    severity=OptimizationSeverity.MEDIUM,
                    estimated_improvement="Reduce retry overhead and improve reliability",
                    affected_nodes=[row.node_id],
                    recommendation_steps=[
                        "Investigate root cause of failures requiring retries",
                        "Implement exponential backoff for retry delays",
                        "Add circuit breaker pattern to prevent cascading failures",
                        "Consider increasing timeout before first retry",
                        "Add better error detection to avoid retrying non-transient errors",
                    ],
                    code_example="""
# Optimize retry configuration
{
  "retry_count": 3,
  "retry_strategy": "exponential_backoff",
  "initial_delay_ms": 1000,
  "max_delay_ms": 10000,
  "backoff_multiplier": 2,
  "retry_on_errors": ["timeout", "rate_limit", "server_error"]
}
""",
                    supporting_metrics={
                        "avg_retries": float(row.avg_retries),
                        "total_retries": int(row.total_retries),
                        "execution_count": row.execution_count,
                    },
                )
                recommendations.append(recommendation)
        
        return recommendations
