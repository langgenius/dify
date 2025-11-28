"""
Workflow Performance Analytics API Controllers

This module provides REST API endpoints for workflow performance analytics,
caching management, and optimization recommendations.
"""

from flask import request
from flask_restful import Resource, marshal_with, reqparse

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from libs.login import login_required
from services.workflow_cache_service import WorkflowCacheService
from services.workflow_optimization_advisor import WorkflowOptimizationAdvisor
from services.workflow_performance_service import WorkflowPerformanceService


class WorkflowPerformanceSummaryAPI(Resource):
    """Get workflow performance summary."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def get(self, app_model, workflow_id):
        """
        Get aggregated performance summary for a workflow.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            Performance summary with metrics
        """
        parser = reqparse.RequestParser()
        parser.add_argument("days", type=int, default=7, location="args")
        args = parser.parse_args()

        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=workflow_id,
            days=args["days"],
        )

        return {
            "workflow_id": workflow_id,
            "period_days": args["days"],
            "summary": summary,
        }


class WorkflowNodePerformanceAPI(Resource):
    """Get node-level performance breakdown."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def get(self, app_model, workflow_id):
        """
        Get performance breakdown by node type.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            Node performance breakdown
        """
        parser = reqparse.RequestParser()
        parser.add_argument("days", type=int, default=7, location="args")
        args = parser.parse_args()

        breakdown = WorkflowPerformanceService.get_node_performance_breakdown(
            workflow_id=workflow_id,
            days=args["days"],
        )

        return {
            "workflow_id": workflow_id,
            "period_days": args["days"],
            "nodes": breakdown,
        }


class WorkflowBottlenecksAPI(Resource):
    """Identify workflow bottlenecks."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def get(self, app_model, workflow_id):
        """
        Identify performance bottlenecks in a workflow.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            List of identified bottlenecks
        """
        parser = reqparse.RequestParser()
        parser.add_argument("days", type=int, default=7, location="args")
        parser.add_argument("threshold_percentile", type=float, default=90.0, location="args")
        args = parser.parse_args()

        bottlenecks = WorkflowPerformanceService.identify_bottlenecks(
            workflow_id=workflow_id,
            days=args["days"],
            threshold_percentile=args["threshold_percentile"],
        )

        return {
            "workflow_id": workflow_id,
            "period_days": args["days"],
            "bottlenecks": bottlenecks,
        }


class WorkflowOptimizationRecommendationsAPI(Resource):
    """Manage optimization recommendations."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def get(self, app_model, workflow_id):
        """
        Get active optimization recommendations.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            List of active recommendations
        """
        parser = reqparse.RequestParser()
        parser.add_argument("category", type=str, location="args")
        parser.add_argument("severity", type=str, location="args")
        args = parser.parse_args()

        recommendations = WorkflowPerformanceService.get_active_recommendations(
            workflow_id=workflow_id,
            category=args.get("category"),
            severity=args.get("severity"),
        )

        return {
            "workflow_id": workflow_id,
            "recommendations": [
                {
                    "id": rec.id,
                    "title": rec.title,
                    "description": rec.description,
                    "category": rec.category,
                    "severity": rec.severity,
                    "estimated_improvement": rec.estimated_improvement,
                    "affected_nodes": rec.affected_nodes,
                    "recommendation_steps": rec.recommendation_steps,
                    "code_example": rec.code_example,
                    "documentation_link": rec.documentation_link,
                    "supporting_metrics": rec.supporting_metrics,
                    "created_at": rec.created_at.isoformat(),
                }
                for rec in recommendations
            ],
            "total": len(recommendations),
        }

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[])
    def post(self, app_model, workflow_id):
        """
        Generate new optimization recommendations.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            Generated recommendations
        """
        parser = reqparse.RequestParser()
        parser.add_argument("days", type=int, default=7, location="json")
        args = parser.parse_args()

        recommendations = WorkflowOptimizationAdvisor.analyze_and_recommend(
            app_id=app_model.id,
            workflow_id=workflow_id,
            days=args["days"],
        )

        return {
            "workflow_id": workflow_id,
            "recommendations": [
                {
                    "id": rec.id,
                    "title": rec.title,
                    "category": rec.category,
                    "severity": rec.severity,
                    "estimated_improvement": rec.estimated_improvement,
                }
                for rec in recommendations
            ],
            "total": len(recommendations),
        }


class DismissRecommendationAPI(Resource):
    """Dismiss an optimization recommendation."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def post(self, app_model, workflow_id, recommendation_id):
        """
        Dismiss an optimization recommendation.

        Args:
            app_model: Application model
            workflow_id: Workflow ID
            recommendation_id: Recommendation ID

        Returns:
            Success message
        """
        parser = reqparse.RequestParser()
        parser.add_argument("reason", type=str, location="json")
        args = parser.parse_args()

        # Get current user ID from request context
        from flask_login import current_user

        recommendation = WorkflowPerformanceService.dismiss_recommendation(
            recommendation_id=recommendation_id,
            dismissed_by=current_user.id,
            reason=args.get("reason"),
        )

        if not recommendation:
            return {"message": "Recommendation not found"}, 404

        return {
            "message": "Recommendation dismissed successfully",
            "recommendation_id": recommendation_id,
        }


class WorkflowCacheStatisticsAPI(Resource):
    """Get cache performance statistics."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def get(self, app_model, workflow_id):
        """
        Get cache performance statistics.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            Cache statistics
        """
        parser = reqparse.RequestParser()
        parser.add_argument("days", type=int, default=7, location="args")
        args = parser.parse_args()

        statistics = WorkflowCacheService.get_cache_statistics(
            workflow_id=workflow_id,
            days=args["days"],
        )

        return {
            "workflow_id": workflow_id,
            "period_days": args["days"],
            "statistics": statistics,
        }


class TopCachedNodesAPI(Resource):
    """Get top cached nodes by hit count."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def get(self, app_model, workflow_id):
        """
        Get top cached nodes by hit count.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            List of top cached nodes
        """
        parser = reqparse.RequestParser()
        parser.add_argument("limit", type=int, default=10, location="args")
        args = parser.parse_args()

        top_nodes = WorkflowCacheService.get_top_cached_nodes(
            workflow_id=workflow_id,
            limit=args["limit"],
        )

        return {
            "workflow_id": workflow_id,
            "top_cached_nodes": top_nodes,
        }


class InvalidateCacheAPI(Resource):
    """Invalidate cache entries."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def post(self, app_model, workflow_id):
        """
        Invalidate cache entries based on filters.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            Number of entries invalidated
        """
        parser = reqparse.RequestParser()
        parser.add_argument("node_type", type=str, location="json")
        args = parser.parse_args()

        count = WorkflowCacheService.invalidate_cache(
            workflow_id=workflow_id,
            node_type=args.get("node_type"),
        )

        return {
            "message": f"Invalidated {count} cache entries",
            "count": count,
        }


class CleanupCacheAPI(Resource):
    """Cleanup expired cache entries."""

    @setup_required
    @login_required
    @get_app_model(mode=[])
    def post(self, app_model, workflow_id):
        """
        Remove expired cache entries.

        Args:
            app_model: Application model
            workflow_id: Workflow ID

        Returns:
            Number of entries removed
        """
        count = WorkflowCacheService.cleanup_expired_entries()

        return {
            "message": f"Cleaned up {count} expired cache entries",
            "count": count,
        }


# Register API endpoints
api.add_resource(
    WorkflowPerformanceSummaryAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/performance/summary",
)
api.add_resource(
    WorkflowNodePerformanceAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/performance/nodes",
)
api.add_resource(
    WorkflowBottlenecksAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/performance/bottlenecks",
)
api.add_resource(
    WorkflowOptimizationRecommendationsAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/optimization/recommendations",
)
api.add_resource(
    DismissRecommendationAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/optimization/recommendations/<uuid:recommendation_id>/dismiss",
)
api.add_resource(
    WorkflowCacheStatisticsAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/statistics",
)
api.add_resource(
    TopCachedNodesAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/top-nodes",
)
api.add_resource(
    InvalidateCacheAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/invalidate",
)
api.add_resource(
    CleanupCacheAPI,
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/cleanup",
)
