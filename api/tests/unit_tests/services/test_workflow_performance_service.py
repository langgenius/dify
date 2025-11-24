"""
Unit tests for Workflow Performance Service

This module contains comprehensive tests for the workflow performance
tracking and analytics functionality.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest

from libs.datetime_utils import naive_utc_now
from models.workflow_performance import (
    OptimizationCategory,
    OptimizationSeverity,
    WorkflowNodePerformance,
    WorkflowOptimizationRecommendation,
    WorkflowPerformanceMetrics,
)
from services.workflow_performance_service import WorkflowPerformanceService


class TestWorkflowPerformanceService:
    """Test suite for WorkflowPerformanceService"""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session"""
        with patch("services.workflow_performance_service.db") as mock_db:
            mock_db.session = MagicMock()
            yield mock_db

    def test_record_workflow_execution(self, mock_db_session):
        """Test recording workflow execution metrics"""
        # Arrange
        app_id = "test-app-id"
        workflow_id = "test-workflow-id"
        workflow_run_id = "test-run-id"

        # Act
        metrics = WorkflowPerformanceService.record_workflow_execution(
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            total_execution_time=10.5,
            node_count=5,
            successful_nodes=4,
            failed_nodes=1,
            cached_nodes=2,
            total_tokens_used=1000,
            total_tokens_cost=0.05,
            cache_hit_rate=40.0,
            execution_status="succeeded",
        )

        # Assert
        assert metrics.app_id == app_id
        assert metrics.workflow_id == workflow_id
        assert metrics.workflow_run_id == workflow_run_id
        assert metrics.total_execution_time == 10.5
        assert metrics.node_count == 5
        assert metrics.successful_nodes == 4
        assert metrics.failed_nodes == 1
        assert metrics.cached_nodes == 2
        assert metrics.cache_hit_rate == 40.0
        mock_db_session.session.add.assert_called_once()
        mock_db_session.session.commit.assert_called_once()

    def test_record_node_execution(self, mock_db_session):
        """Test recording node execution metrics"""
        # Arrange
        workflow_run_id = "test-run-id"
        node_id = "test-node-id"
        node_execution_id = "test-execution-id"
        start_time = naive_utc_now()
        end_time = start_time + timedelta(seconds=5)

        # Act
        node_perf = WorkflowPerformanceService.record_node_execution(
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id=node_execution_id,
            node_type="llm",
            node_title="Test LLM Node",
            execution_time=5.0,
            start_time=start_time,
            end_time=end_time,
            tokens_used=500,
            tokens_cost=0.025,
            is_cached=False,
            status="succeeded",
        )

        # Assert
        assert node_perf.workflow_run_id == workflow_run_id
        assert node_perf.node_id == node_id
        assert node_perf.node_type == "llm"
        assert node_perf.execution_time == 5.0
        assert node_perf.tokens_used == 500
        assert node_perf.is_cached is False
        mock_db_session.session.add.assert_called_once()
        mock_db_session.session.commit.assert_called_once()

    def test_create_optimization_recommendation(self, mock_db_session):
        """Test creating optimization recommendation"""
        # Arrange
        app_id = "test-app-id"
        workflow_id = "test-workflow-id"

        # Act
        recommendation = WorkflowPerformanceService.create_optimization_recommendation(
            app_id=app_id,
            workflow_id=workflow_id,
            title="Optimize slow LLM node",
            description="This node is taking too long to execute",
            category=OptimizationCategory.PERFORMANCE,
            severity=OptimizationSeverity.HIGH,
            estimated_improvement="30% faster",
            affected_nodes=["node-1"],
            recommendation_steps=[
                "Use a faster model",
                "Reduce max_tokens",
                "Enable caching",
            ],
            code_example='{"model": "gpt-3.5-turbo"}',
        )

        # Assert
        assert recommendation.app_id == app_id
        assert recommendation.workflow_id == workflow_id
        assert recommendation.title == "Optimize slow LLM node"
        assert recommendation.category == OptimizationCategory.PERFORMANCE.value
        assert recommendation.severity == OptimizationSeverity.HIGH.value
        assert len(recommendation.recommendation_steps) == 3
        assert recommendation.status == "active"
        mock_db_session.session.add.assert_called_once()
        mock_db_session.session.commit.assert_called_once()

    @patch("services.workflow_performance_service.db.session")
    def test_get_workflow_performance_summary_no_data(self, mock_session):
        """Test getting performance summary with no data"""
        # Arrange
        mock_session.execute.return_value.first.return_value = None

        # Act
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id="test-workflow-id",
            days=7,
        )

        # Assert
        assert summary["total_runs"] == 0
        assert summary["avg_execution_time"] == 0.0
        assert summary["success_rate"] == 0.0

    @patch("services.workflow_performance_service.db.session")
    def test_get_workflow_performance_summary_with_data(self, mock_session):
        """Test getting performance summary with data"""
        # Arrange
        mock_result = MagicMock()
        mock_result.total_runs = 100
        mock_result.avg_execution_time = 5.5
        mock_result.min_execution_time = 2.0
        mock_result.max_execution_time = 15.0
        mock_result.avg_cache_hit_rate = 45.0
        mock_result.total_tokens = 50000
        mock_result.total_cost = 2.5
        mock_result.successful_runs = 95
        mock_result.failed_runs = 5

        mock_session.execute.return_value.first.return_value = mock_result

        # Act
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id="test-workflow-id",
            days=7,
        )

        # Assert
        assert summary["total_runs"] == 100
        assert summary["avg_execution_time"] == 5.5
        assert summary["min_execution_time"] == 2.0
        assert summary["max_execution_time"] == 15.0
        assert summary["avg_cache_hit_rate"] == 45.0
        assert summary["total_tokens"] == 50000
        assert summary["total_cost"] == 2.5
        assert summary["success_rate"] == 95.0
        assert summary["error_rate"] == 5.0

    @patch("services.workflow_performance_service.db.session")
    def test_identify_bottlenecks(self, mock_session):
        """Test identifying performance bottlenecks"""
        # Arrange
        mock_run_ids = [("run-1",), ("run-2",), ("run-3",)]
        mock_bottleneck_data = [
            MagicMock(
                node_id="node-1",
                node_type="llm",
                node_title="Slow LLM",
                execution_count=10,
                avg_time=35.0,
                max_time=40.0,
                std_dev=5.0,
            ),
            MagicMock(
                node_id="node-2",
                node_type="http_request",
                node_title="Slow API",
                execution_count=15,
                avg_time=8.0,
                max_time=12.0,
                std_dev=2.0,
            ),
        ]

        mock_session.execute.side_effect = [
            MagicMock(fetchall=lambda: mock_run_ids),
            MagicMock(fetchall=lambda: mock_bottleneck_data),
        ]

        # Act
        bottlenecks = WorkflowPerformanceService.identify_bottlenecks(
            workflow_id="test-workflow-id",
            days=7,
        )

        # Assert
        assert len(bottlenecks) == 2
        assert bottlenecks[0]["node_id"] == "node-1"
        assert bottlenecks[0]["severity"] == "critical"  # > 30 seconds
        assert bottlenecks[1]["node_id"] == "node-2"
        assert bottlenecks[1]["severity"] == "medium"  # < 10 seconds

    @patch("services.workflow_performance_service.db.session")
    def test_get_node_performance_breakdown(self, mock_session):
        """Test getting node performance breakdown"""
        # Arrange
        mock_run_ids = [("run-1",), ("run-2",)]
        mock_node_data = [
            MagicMock(
                node_type="llm",
                execution_count=20,
                avg_execution_time=5.0,
                min_execution_time=2.0,
                max_execution_time=10.0,
                total_tokens=10000,
                total_cost=0.5,
                cache_hits=5,
                failures=1,
            ),
            MagicMock(
                node_type="code",
                execution_count=30,
                avg_execution_time=1.0,
                min_execution_time=0.5,
                max_execution_time=2.0,
                total_tokens=None,
                total_cost=None,
                cache_hits=15,
                failures=0,
            ),
        ]

        mock_session.execute.side_effect = [
            MagicMock(fetchall=lambda: mock_run_ids),
            MagicMock(fetchall=lambda: mock_node_data),
        ]

        # Act
        breakdown = WorkflowPerformanceService.get_node_performance_breakdown(
            workflow_id="test-workflow-id",
            days=7,
        )

        # Assert
        assert len(breakdown) == 2
        assert breakdown[0]["node_type"] == "llm"
        assert breakdown[0]["execution_count"] == 20
        assert breakdown[0]["cache_hit_rate"] == 25.0  # 5/20 * 100
        assert breakdown[0]["failure_rate"] == 5.0  # 1/20 * 100
        assert breakdown[1]["node_type"] == "code"
        assert breakdown[1]["cache_hit_rate"] == 50.0  # 15/30 * 100
        assert breakdown[1]["failure_rate"] == 0.0

    @patch("services.workflow_performance_service.db.session")
    def test_dismiss_recommendation(self, mock_session):
        """Test dismissing a recommendation"""
        # Arrange
        recommendation_id = "test-rec-id"
        dismissed_by = "user-id"
        reason = "Not applicable"

        mock_recommendation = MagicMock(spec=WorkflowOptimizationRecommendation)
        mock_recommendation.id = recommendation_id
        mock_session.get.return_value = mock_recommendation

        # Act
        result = WorkflowPerformanceService.dismiss_recommendation(
            recommendation_id=recommendation_id,
            dismissed_by=dismissed_by,
            reason=reason,
        )

        # Assert
        assert result.status == "dismissed"
        assert result.dismissed_by == dismissed_by
        assert result.dismissed_reason == reason
        assert result.dismissed_at is not None
        mock_session.commit.assert_called_once()

    @patch("services.workflow_performance_service.db.session")
    def test_dismiss_recommendation_not_found(self, mock_session):
        """Test dismissing a non-existent recommendation"""
        # Arrange
        mock_session.get.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="not found"):
            WorkflowPerformanceService.dismiss_recommendation(
                recommendation_id="non-existent",
                dismissed_by="user-id",
            )

    @patch("services.workflow_performance_service.db.session")
    def test_get_active_recommendations(self, mock_session):
        """Test getting active recommendations"""
        # Arrange
        mock_recommendations = [
            MagicMock(
                id="rec-1",
                severity="critical",
                category="performance",
                created_at=naive_utc_now(),
            ),
            MagicMock(
                id="rec-2",
                severity="high",
                category="cost",
                created_at=naive_utc_now(),
            ),
        ]

        mock_session.execute.return_value.scalars.return_value.all.return_value = mock_recommendations

        # Act
        recommendations = WorkflowPerformanceService.get_active_recommendations(
            workflow_id="test-workflow-id",
            severity=OptimizationSeverity.HIGH,
        )

        # Assert
        assert len(recommendations) == 2
        mock_session.execute.assert_called_once()


class TestWorkflowPerformanceMetrics:
    """Test suite for WorkflowPerformanceMetrics model"""

    def test_create_performance_metrics(self):
        """Test creating performance metrics instance"""
        # Arrange & Act
        metrics = WorkflowPerformanceMetrics(
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            total_execution_time=10.0,
            node_count=5,
            successful_nodes=5,
            failed_nodes=0,
            cached_nodes=2,
            avg_node_execution_time=2.0,
            cache_hit_rate=40.0,
            execution_status="succeeded",
        )

        # Assert
        assert metrics.app_id == "app-1"
        assert metrics.workflow_id == "workflow-1"
        assert metrics.total_execution_time == 10.0
        assert metrics.cache_hit_rate == 40.0


class TestWorkflowNodePerformance:
    """Test suite for WorkflowNodePerformance model"""

    def test_create_node_performance(self):
        """Test creating node performance instance"""
        # Arrange & Act
        start_time = naive_utc_now()
        end_time = start_time + timedelta(seconds=5)

        node_perf = WorkflowNodePerformance(
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="exec-1",
            node_type="llm",
            node_title="Test Node",
            execution_time=5.0,
            start_time=start_time,
            end_time=end_time,
            is_cached=False,
            status="succeeded",
        )

        # Assert
        assert node_perf.workflow_run_id == "run-1"
        assert node_perf.node_type == "llm"
        assert node_perf.execution_time == 5.0
        assert node_perf.is_cached is False


class TestWorkflowOptimizationRecommendation:
    """Test suite for WorkflowOptimizationRecommendation model"""

    def test_create_recommendation(self):
        """Test creating optimization recommendation"""
        # Arrange & Act
        recommendation = WorkflowOptimizationRecommendation(
            app_id="app-1",
            workflow_id="workflow-1",
            title="Test Recommendation",
            description="This is a test",
            category="performance",
            severity="high",
            recommendation_steps=["Step 1", "Step 2"],
            status="active",
        )

        # Assert
        assert recommendation.app_id == "app-1"
        assert recommendation.title == "Test Recommendation"
        assert recommendation.category == "performance"
        assert recommendation.severity == "high"
        assert len(recommendation.recommendation_steps) == 2
        assert recommendation.status == "active"
