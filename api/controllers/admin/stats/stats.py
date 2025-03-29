from datetime import datetime

from controllers.admin import api
from controllers.admin.wraps import validate_admin_token_and_extract_info
from flask import Blueprint, request
from flask_restful import Api, Resource  # type: ignore
from models.model import Account, App
from services.stats_service import StatsService
from werkzeug.exceptions import BadRequest


class RiskStats(Resource):
    @validate_admin_token_and_extract_info
    def get(self, app_model: App, account: Account):
        """Get risk level statistics.
        ---
        tags:
          - admin/api/stats
        summary: Get risk level user counts
        description: Get counts of users at different risk levels and their changes
        security:
          - ApiKeyAuth: []
        parameters:
          - name: start_date
            in: query
            type: string
            format: date
            required: true
            description: Start date of the statistics period (YYYY-MM-DD)
          - name: end_date
            in: query
            type: string
            format: date
            required: true
            description: End date of the statistics period (YYYY-MM-DD)
        responses:
          200:
            description: Risk statistics retrieved successfully
            schema:
              type: object
              properties:
                high_risk_count:
                  type: integer
                  description: Current number of high risk users
                high_risk_percentage:
                  type: number
                  format: float
                  description: Percentage of high risk users
                daily_changes:
                  type: object
                  properties:
                    from_yesterday:
                      type: integer
                      description: Change in high risk users compared to yesterday
                    from_last_week:
                      type: integer
                      description: Change in high risk users compared to last week
          400:
            description: Invalid date parameters
        """
        try:
            # Parse date parameters
            start_date_str = request.args.get('start_date')
            end_date_str = request.args.get('end_date')

            if not start_date_str or not end_date_str:
                raise BadRequest("start_date and end_date are required")

            try:
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            except ValueError:
                raise BadRequest("Invalid date format. Use YYYY-MM-DD")

            # Get risk statistics from service
            risk_stats = StatsService.get_risk_stats(
                start_date=start_date,
                end_date=end_date,
                app_id=app_model.id,
                organization_id=account.current_organization_id,
            )

            return risk_stats
        except BadRequest as e:
            return {"error": str(e)}, 400
        except Exception as e:
            return {"error": "An error occurred while processing the request"}, 500


class UserStats(Resource):
    @validate_admin_token_and_extract_info
    def get(self, app_model: App, account: Account):
        """Get daily user statistics.
        ---
        tags:
          - admin/api/stats
        summary: Get daily active and new user counts
        description: Get statistics of daily active users and new users
        security:
          - ApiKeyAuth: []
        parameters:
          - name: start_date
            in: query
            type: string
            format: date
            required: true
            description: Start date of the statistics period (YYYY-MM-DD)
          - name: end_date
            in: query
            type: string
            format: date
            required: true
            description: End date of the statistics period (YYYY-MM-DD)
        responses:
          200:
            description: User statistics retrieved successfully
            schema:
              type: object
              properties:
                daily_stats:
                  type: array
                  items:
                    type: object
                    properties:
                      date:
                        type: string
                        format: date
                      active_users:
                        type: integer
                        description: Number of active users on this date
                      new_users:
                        type: integer
                        description: Number of new users on this date
          400:
            description: Invalid date parameters
        """
        try:
            # Parse date parameters
            start_date_str = request.args.get('start_date')
            end_date_str = request.args.get('end_date')

            if not start_date_str or not end_date_str:
                raise BadRequest("start_date and end_date are required")

            try:
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
                end_date = end_date.replace(hour=23, minute=59, second=59)
            except ValueError:
                raise BadRequest("Invalid date format. Use YYYY-MM-DD")

            # Get user statistics from service
            user_stats = StatsService.get_user_stats(
                start_date=start_date,
                end_date=end_date,
                app_id=app_model.id,
                organization_id=account.current_organization_id,
            )

            return user_stats
        except BadRequest as e:
            return {"error": str(e)}, 400
        except Exception as e:
            return {"error": "An error occurred while processing the request"}, 500


class ConversationStats(Resource):
    @validate_admin_token_and_extract_info
    def get(self, app_model: App, account: Account):
        """Get daily conversation statistics.
        ---
        tags:
          - admin/api/stats
        summary: Get daily conversation counts and averages
        description: Get statistics of daily total conversations and average conversations per user
        security:
          - ApiKeyAuth: []
        parameters:
          - name: start_date
            in: query
            type: string
            format: date
            required: true
            description: Start date of the statistics period (YYYY-MM-DD)
          - name: end_date
            in: query
            type: string
            format: date
            required: true
            description: End date of the statistics period (YYYY-MM-DD)
        responses:
          200:
            description: Conversation statistics retrieved successfully
            schema:
              type: object
              properties:
                daily_stats:
                  type: array
                  items:
                    type: object
                    properties:
                      date:
                        type: string
                        format: date
                      total_conversations:
                        type: integer
                        description: Total number of conversations on this date
                      avg_conversations_per_user:
                        type: number
                        format: float
                        description: Average conversations per active user on this date
          400:
            description: Invalid date parameters
        """
        try:
            # Parse date parameters
            start_date_str = request.args.get('start_date')
            end_date_str = request.args.get('end_date')

            if not start_date_str or not end_date_str:
                raise BadRequest("start_date and end_date are required")

            try:
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
                end_date = end_date.replace(hour=23, minute=59, second=59)
            except ValueError:
                raise BadRequest("Invalid date format. Use YYYY-MM-DD")

            # Get conversation statistics from service
            conversation_stats = StatsService.get_conversation_stats(
                start_date=start_date,
                end_date=end_date,
                app_id=app_model.id,
                organization_id=account.current_organization_id,
            )

            return conversation_stats
        except BadRequest as e:
            return {"error": str(e)}, 400
        except Exception as e:
            return {"error": "An error occurred while processing the request"}, 500


api.add_resource(RiskStats, '/stats/risk')
api.add_resource(UserStats, '/stats/user')
api.add_resource(ConversationStats, '/stats/conversation')
