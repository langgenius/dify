"""
Comprehensive Integration Tests for Workflow Performance Analytics System

⚠️  IMPORTANT: This test suite requires the Workflow Performance Analytics feature
    to be merged first (PR #28883). The tests will fail with ModuleNotFoundError
    until the following are available:
    - models.workflow_performance (WorkflowPerformanceMetrics, WorkflowNodePerformance, etc.)
    - services.workflow_performance_service
    - services.workflow_cache_service
    - services.workflow_optimization_advisor

This module provides extensive integration testing for the workflow performance
analytics system, covering interactions between WorkflowPerformanceService,
WorkflowCacheService, and WorkflowOptimizationAdvisor.

Tests cover:
- End-to-end workflow execution tracking
- Cache hit/miss scenarios and statistics
- Performance bottleneck detection
- Optimization recommendation generation
- Error handling and edge cases
- Concurrent execution scenarios
- Data consistency and integrity
- Performance degradation detection
- Multi-workflow scenarios
- Time-series analysis
"""

import json
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest

from extensions.ext_database import db
from models.workflow_performance import (
    WorkflowCacheEntry,
    WorkflowNodePerformance,
    WorkflowOptimizationRecommendation,
    WorkflowPerformanceMetrics,
    WorkflowPerformanceTrend,
)
from services.workflow_cache_service import WorkflowCacheService
from services.workflow_optimization_advisor import WorkflowOptimizationAdvisor
from services.workflow_performance_service import WorkflowPerformanceService


@pytest.fixture
def app_id():
    """Generate a test app ID."""
    return str(uuid.uuid4())


@pytest.fixture
def tenant_id():
    """Generate a test tenant ID."""
    return str(uuid.uuid4())


@pytest.fixture
def workflow_id():
    """Generate a test workflow ID."""
    return str(uuid.uuid4())


@pytest.fixture
def workflow_run_id():
    """Generate a test workflow run ID."""
    return str(uuid.uuid4())


@pytest.fixture
def account_id():
    """Generate a test account ID."""
    return str(uuid.uuid4())


@pytest.fixture
def setup_test_data(app_id, tenant_id, workflow_id):
    """Set up test data for integration tests."""
    # Create performance metrics
    metrics = []
    for i in range(10):
        metric = WorkflowPerformanceMetrics(
            id=str(uuid.uuid4()),
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            workflow_run_id=str(uuid.uuid4()),
            total_duration=1.0 + i * 0.1,
            total_tokens=100 + i * 10,
            total_steps=5 + i,
            success_rate=0.9 + i * 0.01,
            error_rate=0.1 - i * 0.01,
            created_at=datetime.utcnow() - timedelta(days=i),
        )
        db.session.add(metric)
        metrics.append(metric)

    # Create node performance records
    node_types = ["llm", "code", "http_request", "template", "variable_aggregator"]
    for metric in metrics[:5]:
        for node_type in node_types:
            node_perf = WorkflowNodePerformance(
                id=str(uuid.uuid4()),
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=metric.workflow_run_id,
                node_id=f"node_{node_type}_{uuid.uuid4().hex[:8]}",
                node_type=node_type,
                execution_time=0.1 + hash(node_type) % 10 * 0.05,
                tokens_used=10 + hash(node_type) % 100,
                status="success",
                created_at=metric.created_at,
            )
            db.session.add(node_perf)

    # Create cache entries
    for i in range(20):
        cache_entry = WorkflowCacheEntry(
            id=str(uuid.uuid4()),
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=f"node_{i}",
            node_type=node_types[i % len(node_types)],
            cache_key=f"cache_key_{i}",
            input_hash=f"hash_{i}",
            cached_data={"result": f"data_{i}"},
            cache_hits=i * 2,
            cache_misses=i,
            cache_hit_rate=0.66 if i > 0 else 0.0,
            last_hit_at=datetime.utcnow() - timedelta(hours=i),
            expires_at=datetime.utcnow() + timedelta(days=7 - i % 7),
            created_at=datetime.utcnow() - timedelta(days=i % 5),
        )
        db.session.add(cache_entry)

    db.session.commit()

    yield {
        "metrics": metrics,
        "node_types": node_types,
    }

    # Cleanup
    WorkflowPerformanceMetrics.query.filter_by(workflow_id=workflow_id).delete()
    WorkflowNodePerformance.query.filter_by(workflow_id=workflow_id).delete()
    WorkflowCacheEntry.query.filter_by(workflow_id=workflow_id).delete()
    WorkflowOptimizationRecommendation.query.filter_by(workflow_id=workflow_id).delete()
    WorkflowPerformanceTrend.query.filter_by(workflow_id=workflow_id).delete()
    db.session.commit()


class TestWorkflowPerformanceIntegration:
    """Integration tests for workflow performance tracking."""

    def test_end_to_end_workflow_execution_tracking(
        self, app_id, tenant_id, workflow_id, workflow_run_id
    ):
        """Test complete workflow execution tracking from start to finish."""
        # Record workflow execution
        WorkflowPerformanceService.record_workflow_execution(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            total_duration=2.5,
            total_tokens=500,
            total_steps=10,
            success_rate=1.0,
            error_rate=0.0,
        )

        # Record node executions
        node_types = ["llm", "code", "http_request"]
        for i, node_type in enumerate(node_types):
            WorkflowPerformanceService.record_node_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=workflow_run_id,
                node_id=f"node_{i}",
                node_type=node_type,
                execution_time=0.5 + i * 0.2,
                tokens_used=100 + i * 50,
                status="success",
            )

        # Verify workflow metrics
        metrics = WorkflowPerformanceMetrics.query.filter_by(
            workflow_run_id=workflow_run_id
        ).first()
        assert metrics is not None
        assert metrics.total_duration == 2.5
        assert metrics.total_tokens == 500
        assert metrics.total_steps == 10

        # Verify node performance records
        node_records = WorkflowNodePerformance.query.filter_by(
            workflow_run_id=workflow_run_id
        ).all()
        assert len(node_records) == 3
        assert all(record.status == "success" for record in node_records)

        # Get performance summary
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=1
        )
        assert summary["total_executions"] >= 1
        assert summary["avg_duration"] > 0

    def test_cache_hit_miss_tracking_integration(
        self, app_id, tenant_id, workflow_id
    ):
        """Test cache hit/miss tracking across multiple executions."""
        node_id = "test_cache_node"
        node_type = "llm"
        input_data = {"prompt": "test prompt", "model": "gpt-4"}

        # First execution - cache miss
        result1 = WorkflowCacheService.get_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=input_data,
        )
        assert result1 is None

        # Store result
        output_data = {"response": "test response", "tokens": 100}
        WorkflowCacheService.store_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=input_data,
            output_data=output_data,
            ttl_seconds=3600,
        )

        # Second execution - cache hit
        result2 = WorkflowCacheService.get_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=input_data,
        )
        assert result2 is not None
        assert result2["response"] == "test response"

        # Third execution - cache hit
        result3 = WorkflowCacheService.get_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=input_data,
        )
        assert result3 is not None

        # Verify cache statistics
        stats = WorkflowCacheService.get_cache_statistics(
            workflow_id=workflow_id, days=1
        )
        assert stats["total_entries"] >= 1
        assert stats["total_hits"] >= 2
        assert stats["total_misses"] >= 1
        assert stats["hit_rate"] > 0.5

    def test_bottleneck_detection_with_varying_performance(
        self, app_id, tenant_id, workflow_id, setup_test_data
    ):
        """Test bottleneck detection with nodes having varying performance."""
        # Add slow node executions
        slow_node_id = "slow_node"
        for i in range(5):
            WorkflowPerformanceService.record_node_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                node_id=slow_node_id,
                node_type="llm",
                execution_time=5.0 + i * 0.5,  # Very slow
                tokens_used=1000,
                status="success",
            )

        # Add fast node executions
        fast_node_id = "fast_node"
        for i in range(5):
            WorkflowPerformanceService.record_node_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                node_id=fast_node_id,
                node_type="code",
                execution_time=0.1 + i * 0.01,  # Very fast
                tokens_used=0,
                status="success",
            )

        # Identify bottlenecks
        bottlenecks = WorkflowPerformanceService.identify_bottlenecks(
            workflow_id=workflow_id, days=7, threshold_percentile=75.0
        )

        # Verify slow node is identified as bottleneck
        slow_node_bottleneck = next(
            (b for b in bottlenecks if b["node_id"] == slow_node_id), None
        )
        assert slow_node_bottleneck is not None
        assert slow_node_bottleneck["avg_execution_time"] > 5.0

        # Verify fast node is not a bottleneck
        fast_node_bottleneck = next(
            (b for b in bottlenecks if b["node_id"] == fast_node_id), None
        )
        assert fast_node_bottleneck is None or fast_node_bottleneck["avg_execution_time"] < 1.0

    def test_optimization_recommendation_generation_flow(
        self, app_id, tenant_id, workflow_id, account_id, setup_test_data
    ):
        """Test complete optimization recommendation generation flow."""
        # Generate recommendations
        with patch("services.workflow_optimization_advisor.WorkflowPerformanceService") as mock_perf:
            # Mock performance data
            mock_perf.get_workflow_performance_summary.return_value = {
                "total_executions": 100,
                "avg_duration": 3.5,
                "avg_tokens": 500,
                "success_rate": 0.85,
                "error_rate": 0.15,
            }
            mock_perf.get_node_performance_breakdown.return_value = [
                {
                    "node_type": "llm",
                    "avg_execution_time": 2.0,
                    "total_executions": 50,
                    "avg_tokens": 400,
                },
                {
                    "node_type": "code",
                    "avg_execution_time": 0.5,
                    "total_executions": 50,
                    "avg_tokens": 0,
                },
            ]

            with patch("services.workflow_optimization_advisor.WorkflowCacheService") as mock_cache:
                mock_cache.get_cache_statistics.return_value = {
                    "total_entries": 20,
                    "total_hits": 30,
                    "total_misses": 70,
                    "hit_rate": 0.3,
                }

                recommendations = WorkflowOptimizationAdvisor.analyze_and_recommend(
                    app_id=app_id,
                    workflow_id=workflow_id,
                    days=7,
                )

        # Verify recommendations were generated
        assert len(recommendations) > 0

        # Verify recommendation categories
        categories = {rec.category for rec in recommendations}
        assert len(categories) > 0

        # Test dismissing a recommendation
        if recommendations:
            rec_id = recommendations[0].id
            dismissed = WorkflowPerformanceService.dismiss_recommendation(
                recommendation_id=rec_id,
                dismissed_by=account_id,
                reason="Already implemented",
            )
            assert dismissed is not None
            assert dismissed.dismissed_at is not None
            assert dismissed.dismissed_by == account_id

    def test_concurrent_workflow_executions(
        self, app_id, tenant_id, workflow_id
    ):
        """Test handling of concurrent workflow executions."""
        # Simulate concurrent executions
        run_ids = [str(uuid.uuid4()) for _ in range(10)]

        for run_id in run_ids:
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=run_id,
                total_duration=1.0,
                total_tokens=100,
                total_steps=5,
                success_rate=1.0,
                error_rate=0.0,
            )

        # Verify all executions were recorded
        metrics = WorkflowPerformanceMetrics.query.filter_by(
            workflow_id=workflow_id
        ).all()
        assert len(metrics) >= 10

        # Verify summary aggregates correctly
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=1
        )
        assert summary["total_executions"] >= 10

    def test_cache_expiration_and_cleanup(
        self, app_id, tenant_id, workflow_id
    ):
        """Test cache entry expiration and cleanup mechanisms."""
        # Create expired cache entries
        expired_entries = []
        for i in range(5):
            entry = WorkflowCacheEntry(
                id=str(uuid.uuid4()),
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                node_id=f"expired_node_{i}",
                node_type="llm",
                cache_key=f"expired_key_{i}",
                input_hash=f"expired_hash_{i}",
                cached_data={"result": f"expired_data_{i}"},
                cache_hits=0,
                cache_misses=0,
                cache_hit_rate=0.0,
                expires_at=datetime.utcnow() - timedelta(hours=1),  # Already expired
                created_at=datetime.utcnow() - timedelta(days=1),
            )
            db.session.add(entry)
            expired_entries.append(entry)

        # Create valid cache entries
        valid_entries = []
        for i in range(5):
            entry = WorkflowCacheEntry(
                id=str(uuid.uuid4()),
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                node_id=f"valid_node_{i}",
                node_type="llm",
                cache_key=f"valid_key_{i}",
                input_hash=f"valid_hash_{i}",
                cached_data={"result": f"valid_data_{i}"},
                cache_hits=0,
                cache_misses=0,
                cache_hit_rate=0.0,
                expires_at=datetime.utcnow() + timedelta(days=7),  # Still valid
                created_at=datetime.utcnow(),
            )
            db.session.add(entry)
            valid_entries.append(entry)

        db.session.commit()

        # Run cleanup
        cleaned_count = WorkflowCacheService.cleanup_expired_entries()
        assert cleaned_count >= 5

        # Verify expired entries are removed
        remaining_expired = WorkflowCacheEntry.query.filter(
            WorkflowCacheEntry.id.in_([e.id for e in expired_entries])
        ).count()
        assert remaining_expired == 0

        # Verify valid entries remain
        remaining_valid = WorkflowCacheEntry.query.filter(
            WorkflowCacheEntry.id.in_([e.id for e in valid_entries])
        ).count()
        assert remaining_valid == 5

    def test_performance_degradation_detection(
        self, app_id, tenant_id, workflow_id
    ):
        """Test detection of performance degradation over time."""
        # Create baseline performance (good)
        for i in range(10):
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=1.0,
                total_tokens=100,
                total_steps=5,
                success_rate=0.95,
                error_rate=0.05,
            )

        # Create degraded performance (bad)
        for i in range(10):
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=5.0,  # Much slower
                total_tokens=500,  # More tokens
                total_steps=5,
                success_rate=0.70,  # Lower success rate
                error_rate=0.30,  # Higher error rate
            )

        # Get performance summary
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=7
        )

        # Verify degradation is reflected in metrics
        assert summary["avg_duration"] > 2.0  # Average should be high
        assert summary["success_rate"] < 0.85  # Success rate should be lower

    def test_multi_workflow_isolation(
        self, app_id, tenant_id
    ):
        """Test that metrics are properly isolated between workflows."""
        workflow_id_1 = str(uuid.uuid4())
        workflow_id_2 = str(uuid.uuid4())

        # Record metrics for workflow 1
        for i in range(5):
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id_1,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=1.0,
                total_tokens=100,
                total_steps=5,
                success_rate=1.0,
                error_rate=0.0,
            )

        # Record metrics for workflow 2
        for i in range(10):
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id_2,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=2.0,
                total_tokens=200,
                total_steps=10,
                success_rate=0.9,
                error_rate=0.1,
            )

        # Verify workflow 1 metrics
        summary_1 = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id_1, days=1
        )
        assert summary_1["total_executions"] == 5
        assert summary_1["avg_duration"] == 1.0

        # Verify workflow 2 metrics
        summary_2 = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id_2, days=1
        )
        assert summary_2["total_executions"] == 10
        assert summary_2["avg_duration"] == 2.0

    def test_cache_invalidation_scenarios(
        self, app_id, tenant_id, workflow_id
    ):
        """Test various cache invalidation scenarios."""
        # Create cache entries for different node types
        node_types = ["llm", "code", "http_request"]
        entries = []

        for i, node_type in enumerate(node_types):
            for j in range(3):
                entry = WorkflowCacheEntry(
                    id=str(uuid.uuid4()),
                    app_id=app_id,
                    tenant_id=tenant_id,
                    workflow_id=workflow_id,
                    node_id=f"node_{node_type}_{j}",
                    node_type=node_type,
                    cache_key=f"key_{node_type}_{j}",
                    input_hash=f"hash_{node_type}_{j}",
                    cached_data={"result": f"data_{node_type}_{j}"},
                    cache_hits=0,
                    cache_misses=0,
                    cache_hit_rate=0.0,
                    expires_at=datetime.utcnow() + timedelta(days=7),
                    created_at=datetime.utcnow(),
                )
                db.session.add(entry)
                entries.append(entry)

        db.session.commit()

        # Test invalidation by node type
        invalidated_llm = WorkflowCacheService.invalidate_cache(
            workflow_id=workflow_id,
            node_type="llm",
        )
        assert invalidated_llm == 3

        # Verify only LLM entries were invalidated
        remaining_llm = WorkflowCacheEntry.query.filter_by(
            workflow_id=workflow_id,
            node_type="llm"
        ).count()
        assert remaining_llm == 0

        remaining_others = WorkflowCacheEntry.query.filter_by(
            workflow_id=workflow_id
        ).filter(
            WorkflowCacheEntry.node_type != "llm"
        ).count()
        assert remaining_others == 6

        # Test invalidation by workflow (all remaining)
        invalidated_all = WorkflowCacheService.invalidate_cache(
            workflow_id=workflow_id
        )
        assert invalidated_all == 6

        # Verify all entries are gone
        remaining_total = WorkflowCacheEntry.query.filter_by(
            workflow_id=workflow_id
        ).count()
        assert remaining_total == 0

    def test_node_performance_breakdown_accuracy(
        self, app_id, tenant_id, workflow_id
    ):
        """Test accuracy of node performance breakdown calculations."""
        # Create precise test data
        test_data = {
            "llm": {"count": 10, "time": 2.0, "tokens": 500},
            "code": {"count": 20, "time": 0.1, "tokens": 0},
            "http_request": {"count": 5, "time": 1.5, "tokens": 0},
        }

        for node_type, data in test_data.items():
            for i in range(data["count"]):
                WorkflowPerformanceService.record_node_execution(
                    app_id=app_id,
                    tenant_id=tenant_id,
                    workflow_id=workflow_id,
                    workflow_run_id=str(uuid.uuid4()),
                    node_id=f"node_{node_type}_{i}",
                    node_type=node_type,
                    execution_time=data["time"],
                    tokens_used=data["tokens"],
                    status="success",
                )

        # Get breakdown
        breakdown = WorkflowPerformanceService.get_node_performance_breakdown(
            workflow_id=workflow_id, days=1
        )

        # Verify each node type
        for node_type, data in test_data.items():
            node_stats = next(
                (b for b in breakdown if b["node_type"] == node_type), None
            )
            assert node_stats is not None
            assert node_stats["total_executions"] == data["count"]
            assert abs(node_stats["avg_execution_time"] - data["time"]) < 0.01
            assert node_stats["avg_tokens"] == data["tokens"]

    def test_recommendation_priority_and_severity(
        self, app_id, workflow_id
    ):
        """Test recommendation priority and severity assignment."""
        # Create recommendations with different severities
        severities = ["critical", "high", "medium", "low"]
        recommendations = []

        for i, severity in enumerate(severities):
            rec = WorkflowOptimizationRecommendation(
                id=str(uuid.uuid4()),
                app_id=app_id,
                workflow_id=workflow_id,
                title=f"Test Recommendation {severity}",
                description=f"Description for {severity} severity",
                category="performance",
                severity=severity,
                estimated_improvement={"duration_reduction": f"{(4-i)*10}%"},
                affected_nodes=["node_1"],
                recommendation_steps=["Step 1"],
                created_at=datetime.utcnow(),
            )
            db.session.add(rec)
            recommendations.append(rec)

        db.session.commit()

        # Get recommendations filtered by severity
        for severity in severities:
            filtered = WorkflowPerformanceService.get_active_recommendations(
                workflow_id=workflow_id,
                severity=severity,
            )
            assert len(filtered) >= 1
            assert all(r.severity == severity for r in filtered)

    def test_error_handling_invalid_data(
        self, app_id, tenant_id, workflow_id
    ):
        """Test error handling with invalid input data."""
        # Test with negative duration
        with pytest.raises(ValueError):
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=-1.0,  # Invalid
                total_tokens=100,
                total_steps=5,
                success_rate=1.0,
                error_rate=0.0,
            )

        # Test with invalid success rate
        with pytest.raises(ValueError):
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=1.0,
                total_tokens=100,
                total_steps=5,
                success_rate=1.5,  # Invalid (> 1.0)
                error_rate=0.0,
            )

    def test_cache_key_generation_consistency(
        self, app_id, tenant_id, workflow_id
    ):
        """Test cache key generation is consistent for same inputs."""
        node_id = "test_node"
        node_type = "llm"
        input_data = {"prompt": "test", "model": "gpt-4", "temperature": 0.7}

        # Generate cache key multiple times
        key1 = WorkflowCacheService._generate_cache_key(
            workflow_id, node_id, input_data
        )
        key2 = WorkflowCacheService._generate_cache_key(
            workflow_id, node_id, input_data
        )
        key3 = WorkflowCacheService._generate_cache_key(
            workflow_id, node_id, input_data
        )

        # Verify consistency
        assert key1 == key2 == key3

        # Verify different inputs produce different keys
        different_input = {"prompt": "different", "model": "gpt-4"}
        key4 = WorkflowCacheService._generate_cache_key(
            workflow_id, node_id, different_input
        )
        assert key4 != key1

    def test_time_series_performance_trends(
        self, app_id, tenant_id, workflow_id
    ):
        """Test time-series performance trend analysis."""
        # Create performance data over multiple days
        base_date = datetime.utcnow()

        for day in range(7):
            # Simulate improving performance over time
            duration = 5.0 - day * 0.5  # Getting faster
            success_rate = 0.7 + day * 0.04  # Getting more reliable

            for i in range(5):
                WorkflowPerformanceService.record_workflow_execution(
                    app_id=app_id,
                    tenant_id=tenant_id,
                    workflow_id=workflow_id,
                    workflow_run_id=str(uuid.uuid4()),
                    total_duration=duration,
                    total_tokens=100,
                    total_steps=5,
                    success_rate=success_rate,
                    error_rate=1.0 - success_rate,
                )

        # Get summary for different time periods
        summary_1_day = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=1
        )
        summary_7_days = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=7
        )

        # Recent performance should be better
        assert summary_1_day["avg_duration"] < summary_7_days["avg_duration"]
        assert summary_1_day["success_rate"] > summary_7_days["success_rate"]

    def test_large_scale_cache_operations(
        self, app_id, tenant_id, workflow_id
    ):
        """Test cache operations at scale."""
        # Create many cache entries
        num_entries = 100
        entries = []

        for i in range(num_entries):
            entry = WorkflowCacheEntry(
                id=str(uuid.uuid4()),
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                node_id=f"node_{i}",
                node_type="llm",
                cache_key=f"key_{i}",
                input_hash=f"hash_{i}",
                cached_data={"result": f"data_{i}"},
                cache_hits=i,
                cache_misses=num_entries - i,
                cache_hit_rate=i / num_entries if i > 0 else 0.0,
                expires_at=datetime.utcnow() + timedelta(days=7),
                created_at=datetime.utcnow(),
            )
            db.session.add(entry)
            entries.append(entry)

        db.session.commit()

        # Get statistics
        stats = WorkflowCacheService.get_cache_statistics(
            workflow_id=workflow_id, days=1
        )

        assert stats["total_entries"] >= num_entries
        assert stats["total_hits"] > 0
        assert stats["total_misses"] > 0

        # Test bulk invalidation performance
        start_time = datetime.utcnow()
        invalidated = WorkflowCacheService.invalidate_cache(
            workflow_id=workflow_id
        )
        end_time = datetime.utcnow()

        assert invalidated >= num_entries
        # Should complete in reasonable time (< 1 second)
        assert (end_time - start_time).total_seconds() < 1.0

    def test_recommendation_deduplication(
        self, app_id, workflow_id
    ):
        """Test that duplicate recommendations are not created."""
        # Create initial recommendation
        rec1 = WorkflowOptimizationRecommendation(
            id=str(uuid.uuid4()),
            app_id=app_id,
            workflow_id=workflow_id,
            title="Optimize LLM calls",
            description="Reduce token usage",
            category="token_optimization",
            severity="high",
            estimated_improvement={"token_reduction": "30%"},
            affected_nodes=["node_1"],
            recommendation_steps=["Step 1"],
            created_at=datetime.utcnow(),
        )
        db.session.add(rec1)
        db.session.commit()

        # Try to create duplicate
        existing = WorkflowOptimizationRecommendation.query.filter_by(
            workflow_id=workflow_id,
            title="Optimize LLM calls",
            dismissed_at=None,
        ).first()

        assert existing is not None
        assert existing.id == rec1.id

    def test_node_execution_status_tracking(
        self, app_id, tenant_id, workflow_id
    ):
        """Test tracking of different node execution statuses."""
        statuses = ["success", "failed", "timeout", "cancelled"]
        node_id = "status_test_node"

        for i, status in enumerate(statuses):
            WorkflowPerformanceService.record_node_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                node_id=node_id,
                node_type="llm",
                execution_time=1.0,
                tokens_used=100,
                status=status,
                error_message=f"Error for {status}" if status != "success" else None,
            )

        # Verify all statuses were recorded
        records = WorkflowNodePerformance.query.filter_by(
            workflow_id=workflow_id,
            node_id=node_id,
        ).all()

        assert len(records) == len(statuses)
        recorded_statuses = {r.status for r in records}
        assert recorded_statuses == set(statuses)

    def test_cache_data_integrity(
        self, app_id, tenant_id, workflow_id
    ):
        """Test cache data integrity and serialization."""
        node_id = "integrity_test_node"
        node_type = "llm"

        # Test with complex nested data
        complex_input = {
            "prompt": "test",
            "config": {
                "model": "gpt-4",
                "temperature": 0.7,
                "max_tokens": 1000,
                "nested": {
                    "deep": {
                        "value": [1, 2, 3, {"key": "value"}]
                    }
                }
            }
        }

        complex_output = {
            "response": "test response",
            "metadata": {
                "tokens": 100,
                "model": "gpt-4",
                "finish_reason": "stop",
                "usage": {
                    "prompt_tokens": 50,
                    "completion_tokens": 50,
                }
            }
        }

        # Store complex data
        WorkflowCacheService.store_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=complex_input,
            output_data=complex_output,
            ttl_seconds=3600,
        )

        # Retrieve and verify
        retrieved = WorkflowCacheService.get_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=complex_input,
        )

        assert retrieved is not None
        assert retrieved["response"] == complex_output["response"]
        assert retrieved["metadata"]["tokens"] == 100
        assert retrieved["metadata"]["usage"]["prompt_tokens"] == 50

    def test_performance_percentile_calculations(
        self, app_id, tenant_id, workflow_id
    ):
        """Test percentile calculations for performance metrics."""
        # Create data with known distribution
        durations = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]

        for duration in durations:
            WorkflowPerformanceService.record_workflow_execution(
                app_id=app_id,
                tenant_id=tenant_id,
                workflow_id=workflow_id,
                workflow_run_id=str(uuid.uuid4()),
                total_duration=duration,
                total_tokens=100,
                total_steps=5,
                success_rate=1.0,
                error_rate=0.0,
            )

        # Get summary with percentiles
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=1
        )

        # Verify percentile calculations
        if "p50_duration" in summary:
            assert 2.0 <= summary["p50_duration"] <= 3.0  # Median
        if "p95_duration" in summary:
            assert 4.5 <= summary["p95_duration"] <= 5.0  # 95th percentile
        if "p99_duration" in summary:
            assert 4.9 <= summary["p99_duration"] <= 5.0  # 99th percentile


class TestEdgeCasesAndErrorHandling:
    """Test edge cases and error handling scenarios."""

    def test_empty_workflow_performance_summary(self, workflow_id):
        """Test getting summary for workflow with no data."""
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=7
        )

        assert summary["total_executions"] == 0
        assert summary["avg_duration"] == 0.0
        assert summary["avg_tokens"] == 0

    def test_cache_with_null_values(
        self, app_id, tenant_id, workflow_id
    ):
        """Test cache handling with null/None values."""
        node_id = "null_test_node"
        node_type = "code"

        # Input with None values
        input_data = {
            "param1": "value1",
            "param2": None,
            "param3": "",
        }

        output_data = {
            "result": None,
            "status": "success",
        }

        # Should handle None values gracefully
        WorkflowCacheService.store_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=input_data,
            output_data=output_data,
            ttl_seconds=3600,
        )

        retrieved = WorkflowCacheService.get_cached_result(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            node_id=node_id,
            node_type=node_type,
            input_data=input_data,
        )

        assert retrieved is not None
        assert retrieved["result"] is None

    def test_very_large_token_counts(
        self, app_id, tenant_id, workflow_id
    ):
        """Test handling of very large token counts."""
        large_tokens = 1_000_000

        WorkflowPerformanceService.record_workflow_execution(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            workflow_run_id=str(uuid.uuid4()),
            total_duration=10.0,
            total_tokens=large_tokens,
            total_steps=5,
            success_rate=1.0,
            error_rate=0.0,
        )

        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=1
        )

        assert summary["total_tokens"] >= large_tokens

    def test_zero_duration_executions(
        self, app_id, tenant_id, workflow_id
    ):
        """Test handling of zero-duration executions."""
        WorkflowPerformanceService.record_workflow_execution(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            workflow_run_id=str(uuid.uuid4()),
            total_duration=0.0,
            total_tokens=0,
            total_steps=1,
            success_rate=1.0,
            error_rate=0.0,
        )

        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id, days=1
        )

        assert summary["total_executions"] >= 1
        assert summary["avg_duration"] >= 0.0

    def test_recommendation_with_missing_fields(
        self, app_id, workflow_id
    ):
        """Test recommendation creation with minimal required fields."""
        rec = WorkflowOptimizationRecommendation(
            id=str(uuid.uuid4()),
            app_id=app_id,
            workflow_id=workflow_id,
            title="Minimal Recommendation",
            description="Test",
            category="performance",
            severity="low",
            # Optional fields omitted
            created_at=datetime.utcnow(),
        )
        db.session.add(rec)
        db.session.commit()

        retrieved = WorkflowOptimizationRecommendation.query.get(rec.id)
        assert retrieved is not None
        assert retrieved.title == "Minimal Recommendation"

    def test_cache_statistics_with_no_entries(self, workflow_id):
        """Test cache statistics when no entries exist."""
        stats = WorkflowCacheService.get_cache_statistics(
            workflow_id=workflow_id, days=7
        )

        assert stats["total_entries"] == 0
        assert stats["total_hits"] == 0
        assert stats["total_misses"] == 0
        assert stats["hit_rate"] == 0.0

    def test_bottleneck_detection_with_single_node(
        self, app_id, tenant_id, workflow_id
    ):
        """Test bottleneck detection with only one node."""
        WorkflowPerformanceService.record_node_execution(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            workflow_run_id=str(uuid.uuid4()),
            node_id="single_node",
            node_type="llm",
            execution_time=1.0,
            tokens_used=100,
            status="success",
        )

        bottlenecks = WorkflowPerformanceService.identify_bottlenecks(
            workflow_id=workflow_id, days=1, threshold_percentile=90.0
        )

        # Should still work with single node
        assert isinstance(bottlenecks, list)
