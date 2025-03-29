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
            if health_status not in ['normal', 'potential', 'critical']:
                return {"error": "Invalid health_status"}, 400
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


class StudentAnalysis(Resource):
    @validate_admin_token_and_extract_info
    def get(self, app_model: App, account: Account):
        """Get AI analysis and intervention suggestions.
        ---
        tags:
          - admin/api/students
        summary: Get AI analysis for student
        description: Get AI generated analysis, summary and intervention suggestions based on conversation history
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            type: string
            required: true
            description: ID of the student
        responses:
          200:
            description: Analysis retrieved successfully
            schema:
              type: object
              properties:
                summary:
                  type: string
                  description: Summary of conversation content and key points
                analysis:
                  type: string
                  description: Psychological analysis from professional perspective
                suggestions:
                  type: string
                  description: Intervention suggestions for counselors
                last_updated:
                  type: string
                  format: date-time
          401:
            description: Invalid or missing API key
          404:
            description: Student not found or no analysis available
        """
        pass


class StudentStatus(Resource):
    @validate_admin_token_and_extract_info
    def put(self, app_model: App, account: Account):
        """Update student follow-up status.
        ---
        tags:
          - admin/api/students
        summary: Update student status
        description: Update the follow-up status of a student
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            type: string
            required: true
            description: ID of the student
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - status
              properties:
                status:
                  type: string
                  enum: [to_follow, following, resolved]
                  description: |
                    Follow-up status:
                    * to_follow - Needs follow-up
                    * following - Currently following up
                    * resolved - Case resolved
        responses:
          200:
            description: Status updated successfully
            schema:
              type: object
              properties:
                success:
                  type: boolean
                  example: true
                updated_at:
                  type: string
                  format: date-time
          401:
            description: Invalid or missing API key
          404:
            description: Student not found
          400:
            description: Invalid status value
        """
        pass

    @validate_admin_token_and_extract_info
    def get(self, app_model: App, account: Account):
        """Get student follow-up status history.
        ---
        tags:
          - admin/api/students
        summary: Get status history
        description: Get the history of status changes for a student
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            type: string
            required: true
            description: ID of the student
        responses:
          200:
            description: Status history retrieved successfully
            schema:
              type: object
              properties:
                current_status:
                  type: string
                  enum: [to_follow, following, resolved]
                history:
                  type: array
                  items:
                    type: object
                    properties:
                      status:
                        type: string
                        enum: [to_follow, following, resolved]
                      changed_at:
                        type: string
                        format: date-time
                      changed_by:
                        type: string
                        description: Email of admin who made the change
          401:
            description: Invalid or missing API key
          404:
            description: Student not found
        """
        pass


class StudentNote(Resource):
    @validate_admin_token_and_extract_info
    def put(self, app_model: App, account: Account):
        """Update student follow-up note.
        ---
        tags:
          - admin/api/students
        summary: Update student note
        description: Update the follow-up note for a student (max 1000 characters)
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            type: string
            required: true
            description: ID of the student
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - note
              properties:
                note:
                  type: string
                  maxLength: 1000
                  description: Follow-up note content
        responses:
          200:
            description: Note updated successfully
            schema:
              type: object
              properties:
                success:
                  type: boolean
                  example: true
                updated_at:
                  type: string
                  format: date-time
          401:
            description: Invalid or missing API key
          404:
            description: Student not found
          400:
            description: Note too long
        """
        pass

    @validate_admin_token_and_extract_info
    def get(self, app_model: App, account: Account):
        """Get student follow-up note history.
        ---
        tags:
          - admin/api/students
        summary: Get note history
        description: Get the history of note changes for a student
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            type: string
            required: true
            description: ID of the student
        responses:
          200:
            description: Note history retrieved successfully
            schema:
              type: object
              properties:
                current_note:
                  type: string
                history:
                  type: array
                  items:
                    type: object
                    properties:
                      note:
                        type: string
                      changed_at:
                        type: string
                        format: date-time
                      changed_by:
                        type: string
                        description: Email of admin who made the change
          401:
            description: Invalid or missing API key
          404:
            description: Student not found
        """
        pass


api.add_resource(StudentList, '/students')
# api.add_resource(StudentAnalysis, '/students/<string:student_id>/analysis')
# api.add_resource(StudentStatus, '/students/<string:student_id>/status')
# api.add_resource(StudentNote, '/students/<string:student_id>/note')
