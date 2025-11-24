"""
Workflow Performance Analytics Models

This module provides database models for tracking and analyzing workflow performance,
including execution metrics, node-level profiling, and optimization recommendations.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

import sqlalchemy as sa
from sqlalchemy import DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .base import Base, DefaultFieldsMixin
from .types import StringUUID


class PerformanceMetricType(StrEnum):
    """Types of performance metrics tracked"""

    EXECUTION_TIME = "execution_time"
    TOKEN_USAGE = "token_usage"
    MEMORY_USAGE = "memory_usage"
    CACHE_HIT_RATE = "cache_hit_rate"
    ERROR_RATE = "error_rate"
    THROUGHPUT = "throughput"
    LATENCY_P50 = "latency_p50"
    LATENCY_P95 = "latency_p95"
    LATENCY_P99 = "latency_p99"


class OptimizationSeverity(StrEnum):
    """Severity levels for optimization recommendations"""

    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class OptimizationCategory(StrEnum):
    """Categories of optimization recommendations"""

    PERFORMANCE = "performance"
    COST = "cost"
    RELIABILITY = "reliability"
    SCALABILITY = "scalability"
    BEST_PRACTICE = "best_practice"


class WorkflowPerformanceMetrics(Base, DefaultFieldsMixin):
    """
    Stores aggregated performance metrics for workflow executions.
    
    This table tracks performance data at the workflow level, enabling
    trend analysis and performance monitoring over time.
    """

    __tablename__ = "workflow_performance_metrics"
    __table_args__ = (
        Index("idx_wf_perf_workflow_id", "workflow_id"),
        Index("idx_wf_perf_app_id", "app_id"),
        Index("idx_wf_perf_created_at", "created_at"),
        Index("idx_wf_perf_workflow_created", "workflow_id", "created_at"),
        UniqueConstraint("workflow_run_id", name="uq_workflow_run_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=uuidv7)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False, unique=True)
    
    # Execution metrics
    total_execution_time: Mapped[float] = mapped_column(Float, nullable=False, comment="Total execution time in seconds")
    node_count: Mapped[int] = mapped_column(Integer, nullable=False, comment="Number of nodes executed")
    successful_nodes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_nodes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cached_nodes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    
    # Resource usage
    total_tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="Total LLM tokens consumed")
    total_tokens_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Estimated cost in USD")
    peak_memory_mb: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Peak memory usage in MB")
    
    # Performance indicators
    avg_node_execution_time: Mapped[float] = mapped_column(Float, nullable=False, comment="Average node execution time")
    slowest_node_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    slowest_node_time: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cache_hit_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, comment="Percentage of cache hits")
    
    # Execution context
    execution_status: Mapped[str] = mapped_column(String(50), nullable=False, comment="succeeded, failed, partial")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Additional metadata
    metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now)


class WorkflowNodePerformance(Base, DefaultFieldsMixin):
    """
    Stores detailed performance metrics for individual workflow nodes.
    
    This table enables node-level performance analysis and bottleneck identification.
    """

    __tablename__ = "workflow_node_performance"
    __table_args__ = (
        Index("idx_wf_node_perf_workflow_run", "workflow_run_id"),
        Index("idx_wf_node_perf_node_id", "node_id"),
        Index("idx_wf_node_perf_node_type", "node_type"),
        Index("idx_wf_node_perf_created_at", "created_at"),
        UniqueConstraint("workflow_run_id", "node_execution_id", name="uq_workflow_node_execution"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=uuidv7)
    workflow_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    node_execution_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_type: Mapped[str] = mapped_column(String(100), nullable=False)
    node_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Execution metrics
    execution_time: Mapped[float] = mapped_column(Float, nullable=False, comment="Execution time in seconds")
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    
    # Resource usage
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tokens_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    memory_used_mb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Performance indicators
    is_cached: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    cache_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    
    # Status
    status: Mapped[str] = mapped_column(String(50), nullable=False, comment="succeeded, failed, skipped")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Input/Output sizes for analysis
    input_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Additional metadata
    metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now)


class WorkflowOptimizationRecommendation(Base, DefaultFieldsMixin):
    """
    Stores AI-generated optimization recommendations for workflows.
    
    This table contains actionable insights to improve workflow performance,
    reduce costs, and enhance reliability.
    """

    __tablename__ = "workflow_optimization_recommendations"
    __table_args__ = (
        Index("idx_wf_opt_workflow_id", "workflow_id"),
        Index("idx_wf_opt_app_id", "app_id"),
        Index("idx_wf_opt_severity", "severity"),
        Index("idx_wf_opt_category", "category"),
        Index("idx_wf_opt_status", "status"),
        Index("idx_wf_opt_created_at", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=uuidv7)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    
    # Recommendation details
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(
        String(50), 
        nullable=False,
        comment="performance, cost, reliability, scalability, best_practice"
    )
    severity: Mapped[str] = mapped_column(
        String(20), 
        nullable=False,
        comment="info, low, medium, high, critical"
    )
    
    # Impact analysis
    estimated_improvement: Mapped[Optional[str]] = mapped_column(
        String(255), 
        nullable=True,
        comment="e.g., '30% faster', '20% cost reduction'"
    )
    affected_nodes: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)
    
    # Actionable guidance
    recommendation_steps: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    code_example: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    documentation_link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    # Evidence and metrics
    supporting_metrics: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    sample_workflow_runs: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)
    
    # Status tracking
    status: Mapped[str] = mapped_column(
        String(20), 
        nullable=False, 
        default="active",
        comment="active, dismissed, implemented, obsolete"
    )
    dismissed_by: Mapped[Optional[str]] = mapped_column(StringUUID, nullable=True)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    dismissed_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Additional metadata
    metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now, onupdate=naive_utc_now)


class WorkflowCacheEntry(Base, DefaultFieldsMixin):
    """
    Stores cached results for workflow nodes to improve performance.
    
    This table implements intelligent caching with TTL and invalidation strategies.
    """

    __tablename__ = "workflow_cache_entries"
    __table_args__ = (
        Index("idx_wf_cache_key", "cache_key", unique=True),
        Index("idx_wf_cache_node_type", "node_type"),
        Index("idx_wf_cache_expires_at", "expires_at"),
        Index("idx_wf_cache_hit_count", "hit_count"),
        Index("idx_wf_cache_last_accessed", "last_accessed_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=uuidv7)
    cache_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    
    # Node information
    node_type: Mapped[str] = mapped_column(String(100), nullable=False)
    node_config_hash: Mapped[str] = mapped_column(String(64), nullable=False, comment="Hash of node configuration")
    
    # Cached data
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False, comment="Hash of input data")
    output_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    output_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # Cache metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_accessed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    
    # Performance tracking
    original_execution_time: Mapped[float] = mapped_column(Float, nullable=False, comment="Original execution time in seconds")
    total_time_saved: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, comment="Cumulative time saved")
    
    # Additional metadata
    metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)


class WorkflowPerformanceTrend(Base, DefaultFieldsMixin):
    """
    Stores aggregated performance trends for workflows over time.
    
    This table enables historical analysis and trend detection.
    """

    __tablename__ = "workflow_performance_trends"
    __table_args__ = (
        Index("idx_wf_trend_workflow_id", "workflow_id"),
        Index("idx_wf_trend_period", "period_start", "period_end"),
        Index("idx_wf_trend_metric_type", "metric_type"),
        UniqueConstraint("workflow_id", "period_start", "metric_type", name="uq_workflow_period_metric"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=uuidv7)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    
    # Time period
    period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_type: Mapped[str] = mapped_column(String(20), nullable=False, comment="hourly, daily, weekly, monthly")
    
    # Metric information
    metric_type: Mapped[str] = mapped_column(String(50), nullable=False)
    metric_value: Mapped[float] = mapped_column(Float, nullable=False)
    
    # Statistical data
    min_value: Mapped[float] = mapped_column(Float, nullable=False)
    max_value: Mapped[float] = mapped_column(Float, nullable=False)
    avg_value: Mapped[float] = mapped_column(Float, nullable=False)
    median_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    std_deviation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Sample data
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    percentile_95: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    percentile_99: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Additional metadata
    metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=naive_utc_now)
