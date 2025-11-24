"""
Workflow Performance Analytics API Controllers

This module provides REST API endpoints for accessing workflow performance
analytics, optimization recommendations, and cache management.
"""

import logging

from flask_restx import Namespace, Resource, fields, marshal_with, reqparse

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import current_account_with_tenant, login_required
from models.workflow_performance import OptimizationCategory, OptimizationSeverity
from services.workflow_cache_service import WorkflowCacheService
from services.workflow_optimization_advisor import WorkflowOptimizationAdvisor
from services.workflow_performance_service import WorkflowPerformanceService

logger = logging.getLogger(__name__)


# API Response Models
performance_summary_fields = console_ns.model('WorkflowPerformanceSummary', {
    'total_runs': fields.Integer(description='Total number of workflow runs'),
    'avg_execution_time': fields.Float(description='Average execution time in seconds'),
    'min_execution_time': fields.Float(description='Minimum execution time in seconds'),
    'max_execution_time': fields.Float(description='Maximum execution time in seconds'),
    'avg_cache_hit_rate': fields.Float(description='Average cache hit rate percentage'),
    'total_tokens': fields.Integer(description='Total tokens used'),
    'total_cost': fields.Float(description='Total cost in USD'),
    'success_rate': fields.Float(description='Success rate percentage'),
    'error_rate': fields.Float(description='Error rate percentage'),
})

node_performance_fields = console_ns.model('NodePerformance', {
    'node_type': fields.String(description='Type of node'),
    'execution_count': fields.Integer(description='Number of executions'),
    'avg_execution_time': fields.Float(description='Average execution time in seconds'),
    'min_execution_time': fields.Float(description='Minimum execution time in seconds'),
    'max_execution_time': fields.Float(description='Maximum execution time in seconds'),
    'total_tokens': fields.Integer(description='Total tokens used'),
    'total_cost': fields.Float(description='Total cost in USD'),
    'cache_hit_rate': fields.Float(description='Cache hit rate percentage'),
    'failure_rate': fields.Float(description='Failure rate percentage'),
})

bottleneck_fields = console_ns.model('Bottleneck', {
    'node_id': fields.String(description='Node ID'),
    'node_type': fields.String(description='Type of node'),
    'node_title': fields.String(description='Node title'),
    'execution_count': fields.Integer(description='Number of executions'),
    'avg_execution_time': fields.Float(description='Average execution time in seconds'),
    'max_execution_time': fields.Float(description='Maximum execution time in seconds'),
    'std_deviation': fields.Float(description='Standard deviation of execution time'),
    'severity': fields.String(description='Severity level'),
})

optimization_recommendation_fields = console_ns.model('OptimizationRecommendation', {
    'id': fields.String(description='Recommendation ID'),
    'title': fields.String(description='Recommendation title'),
    'description': fields.String(description='Detailed description'),
    'category': fields.String(description='Category'),
    'severity': fields.String(description='Severity level'),
    'estimated_improvement': fields.String(description='Estimated improvement'),
    'affected_nodes': fields.List(fields.String, description='Affected node IDs'),
    'recommendation_steps': fields.List(fields.String, description='Actionable steps'),
    'code_example': fields.String(description='Example code'),
    'documentation_link': fields.String(description='Documentation link'),
    'supporting_metrics': fields.Raw(description='Supporting metrics'),
    'status': fields.String(description='Status'),
    'created_at': fields.DateTime(description='Creation timestamp'),
})

cache_statistics_fields = console_ns.model('CacheStatistics', {
    'total_entries': fields.Integer(description='Total cache entries'),
    'active_entries': fields.Integer(description='Active cache entries'),
    'total_hits': fields.Integer(description='Total cache hits'),
    'avg_hits_per_entry': fields.Float(description='Average hits per entry'),
    'total_time_saved': fields.Float(description='Total time saved in seconds'),
    'avg_execution_time': fields.Float(description='Average execution time'),
    'total_cache_size_mb': fields.Float(description='Total cache size in MB'),
    'cache_efficiency': fields.Float(description='Cache efficiency percentage'),
})


def _serialize_recommendation(rec) -> dict:
    """
    Helper function to serialize a WorkflowOptimizationRecommendation object.
    
    Args:
        rec: WorkflowOptimizationRecommendation instance
        
    Returns:
        Dictionary representation of the recommendation
    """
    return {
        'id': rec.id,
        'title': rec.title,
        'description': rec.description,
        'category': rec.category,
        'severity': rec.severity,
        'estimated_improvement': rec.estimated_improvement,
        'affected_nodes': rec.affected_nodes,
        'recommendation_steps': rec.recommendation_steps,
        'code_example': rec.code_example,
        'documentation_link': rec.documentation_link,
        'supporting_metrics': rec.supporting_metrics,
        'status': rec.status,
        'created_at': rec.created_at.isoformat(),
    }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/performance/summary')
class WorkflowPerformanceSummaryAPI(Resource):
    """API for retrieving workflow performance summary"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(performance_summary_fields)
    def get(self, app_model, workflow_id):
        """
        Get performance summary for a workflow
        """
        parser = reqparse.RequestParser()
        parser.add_argument('days', type=int, default=7, location='args', help='Number of days to analyze')
        args = parser.parse_args()

        summary = WorkflowPerformanceService.get_workflow_performance_summary(
            workflow_id=str(workflow_id),
            days=args['days'],
        )

        return summary


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/performance/nodes')
class WorkflowNodePerformanceAPI(Resource):
    """API for retrieving node-level performance breakdown"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model, workflow_id):
        """
        Get performance breakdown by node type
        """
        parser = reqparse.RequestParser()
        parser.add_argument('days', type=int, default=7, location='args', help='Number of days to analyze')
        args = parser.parse_args()

        breakdown = WorkflowPerformanceService.get_node_performance_breakdown(
            workflow_id=str(workflow_id),
            days=args['days'],
        )

        return {
            'nodes': breakdown
        }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/performance/bottlenecks')
class WorkflowBottlenecksAPI(Resource):
    """API for identifying performance bottlenecks"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model, workflow_id):
        """
        Identify performance bottlenecks in the workflow
        """
        parser = reqparse.RequestParser()
        parser.add_argument('days', type=int, default=7, location='args', help='Number of days to analyze')
        parser.add_argument('threshold_percentile', type=float, default=90.0, location='args')
        args = parser.parse_args()

        bottlenecks = WorkflowPerformanceService.identify_bottlenecks(
            workflow_id=str(workflow_id),
            days=args['days'],
            threshold_percentile=args['threshold_percentile'],
        )

        return {
            'bottlenecks': bottlenecks
        }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/optimization/recommendations')
class WorkflowOptimizationRecommendationsAPI(Resource):
    """API for optimization recommendations"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model, workflow_id):
        """
        Get active optimization recommendations
        """
        parser = reqparse.RequestParser()
        parser.add_argument('severity', type=str, location='args', choices=['info', 'low', 'medium', 'high', 'critical'])
        parser.add_argument('category', type=str, location='args', choices=['performance', 'cost', 'reliability', 'scalability', 'best_practice'])
        args = parser.parse_args()

        severity = OptimizationSeverity(args['severity']) if args['severity'] else None
        category = OptimizationCategory(args['category']) if args['category'] else None

        recommendations = WorkflowPerformanceService.get_active_recommendations(
            workflow_id=str(workflow_id),
            severity=severity,
            category=category,
        )

        return {
            'recommendations': [_serialize_recommendation(rec) for rec in recommendations]
        }

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model, workflow_id):
        """
        Generate new optimization recommendations
        """
        parser = reqparse.RequestParser()
        parser.add_argument('days', type=int, default=7, location='json', help='Number of days to analyze')
        args = parser.parse_args()

        recommendations = WorkflowOptimizationAdvisor.analyze_and_recommend(
            app_id=str(app_model.id),
            workflow_id=str(workflow_id),
            days=args['days'],
        )

        return {
            'recommendations': [_serialize_recommendation(rec) for rec in recommendations],
            'count': len(recommendations),
        }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/optimization/recommendations/<uuid:recommendation_id>/dismiss')
class DismissRecommendationAPI(Resource):
    """API for dismissing optimization recommendations"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model, workflow_id, recommendation_id):
        """
        Dismiss an optimization recommendation
        """
        account, _ = current_account_with_tenant()

        parser = reqparse.RequestParser()
        parser.add_argument('reason', type=str, location='json', help='Reason for dismissal')
        args = parser.parse_args()

        recommendation = WorkflowPerformanceService.dismiss_recommendation(
            recommendation_id=str(recommendation_id),
            dismissed_by=str(account.id),
            reason=args.get('reason'),
        )

        return {
            'id': recommendation.id,
            'status': recommendation.status,
            'dismissed_at': recommendation.dismissed_at.isoformat() if recommendation.dismissed_at else None,
        }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/statistics')
class WorkflowCacheStatisticsAPI(Resource):
    """API for cache performance statistics"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(cache_statistics_fields)
    def get(self, app_model, workflow_id):
        """
        Get cache performance statistics
        """
        parser = reqparse.RequestParser()
        parser.add_argument('days', type=int, default=7, location='args', help='Number of days to analyze')
        parser.add_argument('node_type', type=str, location='args', help='Filter by node type')
        args = parser.parse_args()

        statistics = WorkflowCacheService.get_cache_statistics(
            node_type=args.get('node_type'),
            days=args['days'],
        )

        return statistics


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/top-nodes')
class TopCachedNodesAPI(Resource):
    """API for top cached nodes"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model, workflow_id):
        """
        Get the most frequently cached nodes
        """
        parser = reqparse.RequestParser()
        parser.add_argument('limit', type=int, default=10, location='args', help='Maximum number of results')
        parser.add_argument('days', type=int, default=7, location='args', help='Number of days to analyze')
        args = parser.parse_args()

        top_nodes = WorkflowCacheService.get_top_cached_nodes(
            limit=args['limit'],
            days=args['days'],
        )

        return {
            'nodes': top_nodes
        }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/invalidate')
class InvalidateCacheAPI(Resource):
    """API for cache invalidation"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model, workflow_id):
        """
        Invalidate cache entries
        """
        parser = reqparse.RequestParser()
        parser.add_argument('cache_key', type=str, location='json', help='Specific cache key to invalidate')
        parser.add_argument('node_type', type=str, location='json', help='Invalidate all entries for a node type')
        parser.add_argument('older_than_hours', type=int, location='json', help='Invalidate entries older than specified hours')
        args = parser.parse_args()

        count = WorkflowCacheService.invalidate_cache(
            cache_key=args.get('cache_key'),
            node_type=args.get('node_type'),
            older_than_hours=args.get('older_than_hours'),
        )

        return {
            'invalidated_count': count,
            'message': f'Successfully invalidated {count} cache entries'
        }


@console_ns.route('/apps/<uuid:app_id>/workflows/<uuid:workflow_id>/cache/cleanup')
class CleanupCacheAPI(Resource):
    """API for cleaning up expired cache"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model, workflow_id):
        """
        Clean up expired cache entries
        """
        count = WorkflowCacheService.cleanup_expired_cache()

        return {
            'cleaned_count': count,
            'message': f'Successfully cleaned up {count} expired cache entries'
        }
