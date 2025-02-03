from flask import Blueprint
from flask_restful import Api, Resource # type: ignore

from controllers.admin import api

class RiskStats(Resource):
    def get(self):
        """Get risk level statistics.
        ---
        tags:
          - admin/stats
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
        pass

class UserStats(Resource):
    def get(self):
        """Get daily user statistics.
        ---
        tags:
          - admin/stats
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
        pass

class ConversationStats(Resource):
    def get(self):
        """Get daily conversation statistics.
        ---
        tags:
          - admin/stats
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
        pass

api.add_resource(RiskStats, '/stats/risk')
api.add_resource(UserStats, '/stats/user') 
api.add_resource(ConversationStats, '/stats/conversation')