from controllers.admin import api
from controllers.admin.wraps import validate_admin_token_and_extract_info
from fields.end_user_fields import end_users_infinite_scroll_pagination_fields
from flask import Blueprint
from flask_restful import Api, Resource, marshal_with  # type: ignore
from models.model import Account, App
from services.end_user_service import EndUserService


class StudentList(Resource):
    @validate_admin_token_and_extract_info
    @marshal_with(end_users_infinite_scroll_pagination_fields)
    def get(self, app_model: App, account: Account):
        """Get all end_user list related with the app_model with filters with pagination.
        ---
        tags:
          - admin/api/students
        summary: Get filtered student list
        description: Get list of students with various filter options
        security:
          - ApiKeyAuth: []
        parameters:
          - name: health_status
            in: query
            type: string
            enum: [normal, potential, critical]
            description: Filter by health status
          - name: begin_date
            in: query
            type: integer
            format: date-time as integer timestamp
            description: Filter by begin date
          - name: end_date
            in: query
            type: integer
            format: date-time as integer timestamp
            description: Filter by end date
          - name: page
            in: query
            type: integer
            default: 1
            description: Page number
          - name: limit
            in: query
            type: integer
            default: 20
            description: Items per page
        responses:
          200:
            description: Student list retrieved successfully
            schema:
              type: object
              properties:
                total:
                  type: integer
                  description: Total number of students matching filters
                data:
                  type: array
                  items:
                    type: object
                    properties:
                      id:
                        type: string
                      email:
                        type: string
                      first_chat_at:
                        type: string
                        format: date-time
                      last_chat_at:
                        type: string
                        format: date-time
                      total_messages:
                        type: integer
                      active_days:
                        type: integer
                      topics:
                        type: array
                        items:
                          type: string
                      health_status:
                        type: string
                        enum: [normal, potential, critical]
                      topics:
                        type: array
                        items:
                          type: string
                      summary:
                        type: string
                      major:
                        type: string
                      organization_id:
                        type: string
          401:
            description: Invalid or missing API key
          400:
            description: Invalid filter parameters
        """
        from datetime import datetime

        from flask import request

        # Get query parameters with defaults
        health_status = request.args.get('health_status')
        begin_date = request.args.get('begin_date')
        end_date = request.args.get('end_date')
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 20))

        # Validate parameters
        if begin_date:
            try:
                begin_date = datetime.fromtimestamp(int(begin_date))
            except ValueError:
                return {"error": "Invalid begin_date format"}, 400

        if end_date:
            try:
                end_date = datetime.fromtimestamp(int(end_date))
            except ValueError:
                return {"error": "Invalid end_date format"}, 400

        # Build query filters
        filters = {}
        if health_status:
            filters['health_status'] = health_status

        if begin_date:
            filters['last_chat_at__gte'] = begin_date

        if end_date:
            filters['last_chat_at__lte'] = end_date

        # Get students with pagination
        offset = (page - 1) * limit

        # Get the organization ID from the account
        organization_id = account.current_organization_id

        # Use the organization ID for filtering students by organization
        return EndUserService.pagination_by_filters(
            app_model=app_model, filters=filters, offset=offset, limit=limit, organization_id=organization_id
        )


api.add_resource(StudentList, '/students')
