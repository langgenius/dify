"""
Unit tests for WorkflowOptimizationAdvisor
"""

from unittest.mock import MagicMock, patch
import pytest
from models.workflow_performance import WorkflowOptimizationRecommendation
from services.workflow_optimization_advisor import WorkflowOptimizationAdvisor


class TestWorkflowOptimizationAdvisor:
    """Test suite for WorkflowOptimizationAdvisor."""

    @patch("services.workflow_optimization_advisor.WorkflowPerformanceService")
    @patch("services.workflow_optimization_advisor.db.session")
    def test_analyze_and_recommend_no_data(self, mock_session, mock_perf_service):
        """Test analysis with no workflow data."""
        mock_perf_service.get_workflow_performance_summary.return_value = {"total_runs": 0}
        recommendations = WorkflowOptimizationAdvisor.analyze_and_recommend(
            app_id="test-app-id", workflow_id="test-workflow-id", days=7
        )
        assert recommendations == []

    @patch("services.workflow_optimization_advisor.WorkflowPerformanceService")
    @patch("services.workflow_optimization_advisor.db.session")
    def test_analyze_and_recommend_returns_list(self, mock_session, mock_perf_service):
        """Test that analyze_and_recommend returns a list."""
        mock_perf_service.get_workflow_performance_summary.return_value = {"total_runs": 100}
        mock_session.execute.return_value.fetchall.return_value = []
        recommendations = WorkflowOptimizationAdvisor.analyze_and_recommend(
            app_id="test-app-id", workflow_id="test-workflow-id", days=7
        )
        assert isinstance(recommendations, list)

    def test_recommendation_model_creation(self):
        """Test creating a recommendation instance."""
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
        assert recommendation.title == "Test Recommendation"
        assert recommendation.category == "performance"
        assert recommendation.severity == "high"
        assert recommendation.status == "active"
