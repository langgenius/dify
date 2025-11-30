"""
Unit tests for WorkflowPerformanceService

Comprehensive test coverage for workflow performance tracking and analysis.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from models.workflow_performance import (
    WorkflowNodePerformance,
    WorkflowOptimizationRecommendation,
    WorkflowPerformanceMetrics,
)
from services.workflow_performance_service import WorkflowPerformanceService


class TestWorkflowPerformanceService:
    """Test suite for WorkflowPerformanceService."""

    @patch("services.workflow_performance_service.db.session")
    def test_record_workflow_execution(self, mock_session):
        """Test recording workflow execution metrics."""
        # Arrange
        app_id = "test-app-id"
        workflow_id = "test-workflow-id"
        workflow_run_id = "test-run-id"

        # Act
        result = WorkflowPerformanceService.record_workflow_execution(
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
            execution_status="succeeded",
        )

        # Assert
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        assert isinstance(result, WorkflowPerformanceMetrics)

    @patch("services.workflow_performance_service.db.session")
    def test_record_node_execution(self, mock_session):
        """Test recording node execution metrics."""
        # Arrange
        workflow_run_id = "test-run-id"
        node_id = "test-node-id"
        start_time = datetime.utcnow()
        end_time = start_time + timedelta(seconds=5)

        # Act
        result = WorkflowPerformanceService.record_node_execution(
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            node_execution_id="test-exec-id",
            node_type="llm",
            node_title="Test LLM Node",
            execution_time=5.0,
            start_time=start_time,
            end_time=end_time,
            tokens_used=500,
            tokens_cost=0.025,
            status="succeeded",
        )

        # Assert
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        assert isinstance(result, WorkflowNodePerformance)

    @patch("services.workflow_performance_service.db.session")
    def test_create_optimization_recommendation(self, mock_session):
        """Test creating optimization recommendation."""
        # Arrange
        app_id = "test-app-id"
        workflow_id = "test-workflow-id"

        # Act
        result = WorkflowPerformanceService.create_optimization_recommendation(
            app_id=app_id,
            workflow_id=workflow_id,
            title="Test Recommendation",
            description="Test description",
            category="performance",
            severity="high",
            estimated_improvement="30% faster",
            affected_nodes=["node-1", "node-2"],
            recommendation_steps=["Step 1", "Step 2"],
        )

        # Assert
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        assert isinstance(result, WorkflowOptimizationRecommendation)

    @patch("services.workflow_performance_service.db.session")
    def test_get_workflow_performance_summary_no_data(self, mock_session):
        """Test getting performance summary with no data."""
        # Arrange
        mock_session.execute.return_value.first.return_value = MagicMock(total_runs=0)

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
        """Test getting performance summary with data."""
        # Arrange
        mock_result = MagicMock(
            total_runs=10,
            avg_execution_time=5.5,
            min_execution_time=2.0,
            max_execution_time=10.0,
            total_tokens=5000,
            total_cost=0.25,
            avg_cache_hit_rate=45.5,
            successful_runs=8,
            failed_runs=2,
        )
        mock_session.execute.return_value.first.return_value = mock_result

        # Act
        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id="test-workflow-id",
            days=7,
        )

        # Assert
        assert summary["total_runs"] == 10
        assert summary["avg_execution_time"] == 5.5
        assert summary["successful_runs"] == 8
        assert summary["failed_runs"] == 2
        assert summary["success_rate"] == 80.0

    @patch("services.workflow_performance_service.db.session")
    def test_identify_bottlenecks(self, mock_session):
        """Test identifying performance bottlenecks."""
        # Arrange
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

        mock_session.execute.return_value.fetchall.return_value = mock_bottleneck_data

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
        """Test getting node performance breakdown."""
        # Arrange
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

        mock_session.execute.return_value.fetchall.return_value = mock_node_data

        # Act
        breakdown = WorkflowPerformanceService.get_node_performance_breakdown(
            workflow_id="test-workflow-id",
            days=7,
        )

        # Assert
        assert len(breakdown) == 2
        assert breakdown[0]["node_type"] == "llm"
        assert breakdown[0]["cache_hit_rate"] == 25.0  # 5/20 * 100
        assert breakdown[0]["failure_rate"] == 5.0  # 1/20 * 100
        assert breakdown[1]["node_type"] == "code"
        assert breakdown[1]["cache_hit_rate"] == 50.0  # 15/30 * 100

    @patch("services.workflow_performance_service.db.session")
    def test_dismiss_recommendation(self, mock_session):
        """Test dismissing a recommendation."""
        # Arrange
        recommendation_id = "test-rec-id"
        dismissed_by = "user-id"
        reason = "Not applicable"

        mock_recommendation = MagicMock(spec=WorkflowOptimizationRecommendation)
        mock_session.get.return_value = mock_recommendation

        # Act
        result = WorkflowPerformanceService.dismiss_recommendation(
            recommendation_id=recommendation_id,
            dismissed_by=dismissed_by,
            reason=reason,
        )

        # Assert
        assert result == mock_recommendation
        assert mock_recommendation.status == "dismissed"
        assert mock_recommendation.dismissed_by == dismissed_by
        assert mock_recommendation.dismissed_reason == reason
        mock_session.commit.assert_called_once()

    @patch("services.workflow_performance_service.db.session")
    def test_dismiss_recommendation_not_found(self, mock_session):
        """Test dismissing a non-existent recommendation."""
        # Arrange
        mock_session.get.return_value = None

        # Act
        result = WorkflowPerformanceService.dismiss_recommendation(
            recommendation_id="non-existent-id",
            dismissed_by="user-id",
        )

        # Assert
        assert result is None
        mock_session.commit.assert_not_called()

    @patch("services.workflow_performance_service.db.session")
    def test_get_active_recommendations(self, mock_session):
        """Test getting active recommendations."""
        # Arrange
        mock_recommendations = [
            MagicMock(
                id="rec-1",
                workflow_id="test-workflow-id",
                status="active",
                category="performance",
                severity="critical",
            ),
            MagicMock(
                id="rec-2",
                workflow_id="test-workflow-id",
                status="active",
                category="cost",
                severity="high",
            ),
        ]

        mock_session.execute.return_value.scalars.return_value.all.return_value = mock_recommendations

        # Act
        recommendations = WorkflowPerformanceService.get_active_recommendations(
            workflow_id="test-workflow-id",
        )

        # Assert
        assert len(recommendations) == 2
        assert all(rec.status == "active" for rec in recommendations)

    @patch("services.workflow_performance_service.db.session")
    def test_get_active_recommendations_with_filters(self, mock_session):
        """Test getting active recommendations with category and severity filters."""
        # Arrange
        mock_recommendations = [
            MagicMock(
                id="rec-1",
                workflow_id="test-workflow-id",
                status="active",
                category="performance",
                severity="critical",
            ),
        ]

        mock_session.execute.return_value.scalars.return_value.all.return_value = mock_recommendations

        # Act
        recommendations = WorkflowPerformanceService.get_active_recommendations(
            workflow_id="test-workflow-id",
            category="performance",
            severity="critical",
        )

        # Assert
        assert len(recommendations) == 1
        assert recommendations[0].category == "performance"
        assert recommendations[0].severity == "critical"


class TestWorkflowPerformanceMetrics:
    """Test WorkflowPerformanceMetrics model."""

    def test_create_performance_metrics(self):
        """Test creating a performance metrics instance."""
        # Arrange & Act
        metrics = WorkflowPerformanceMetrics(
            app_id="test-app-id",
            workflow_id="test-workflow-id",
            workflow_run_id="test-run-id",
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
        assert metrics.workflow_id == "test-workflow-id"
        assert metrics.total_execution_time == 10.0
        assert metrics.node_count == 5


class TestWorkflowNodePerformance:
    """Test WorkflowNodePerformance model."""

    def test_create_node_performance(self):
        """Test creating a node performance instance."""
        # Arrange & Act
        start_time = datetime.utcnow()
        end_time = start_time + timedelta(seconds=5)

        node_perf = WorkflowNodePerformance(
            workflow_run_id="test-run-id",
            node_id="test-node-id",
            node_execution_id="test-exec-id",
            node_type="llm",
            node_title="Test Node",
            execution_time=5.0,
            start_time=start_time,
            end_time=end_time,
            status="succeeded",
        )

        # Assert
        assert node_perf.node_id == "test-node-id"
        assert node_perf.node_type == "llm"
        assert node_perf.execution_time == 5.0


class TestWorkflowOptimizationRecommendation:
    """Test WorkflowOptimizationRecommendation model."""

    def test_create_recommendation(self):
        """Test creating an optimization recommendation."""
        # Arrange & Act
        recommendation = WorkflowOptimizationRecommendation(
            app_id="test-app-id",
            workflow_id="test-workflow-id",
            title="Test Recommendation",
            description="Test description",
            category="performance",
            severity="high",
            recommendation_steps=["Step 1", "Step 2"],
            status="active",
        )

        # Assert
        assert recommendation.title == "Test Recommendation"
        assert recommendation.category == "performance"
        assert recommendation.severity == "high"
        assert recommendation.status == "active"
