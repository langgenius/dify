from flask import Blueprint
from flask_restful import Api, Resource # type: ignore

from controllers.admin import api

class StudentList(Resource):
    def get(self):
        """Get student list with filters.
        ---
        tags:
          - admin/students
        summary: Get filtered student list
        description: Get list of students with various filter options
        security:
          - ApiKeyAuth: []
        parameters:
          - name: risk_level
            in: query
            type: string
            enum: [high, medium, low]
            description: Filter by risk level
          - name: last_chat_after
            in: query
            type: string
            format: date
            description: Filter by last conversation date
          - name: topics
            in: query
            type: array
            items:
              type: string
            description: Filter by conversation topics
          - name: is_anonymous
            in: query
            type: boolean
            description: Filter anonymous users
          - name: page
            in: query
            type: integer
            default: 1
            description: Page number
          - name: per_page
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
                students:
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
                      total_conversations:
                        type: integer
                      active_days:
                        type: integer
                      topics:
                        type: array
                        items:
                          type: string
                      risk_level:
                        type: string
                        enum: [high, medium, low]
          401:
            description: Invalid or missing API key
          400:
            description: Invalid filter parameters
        """
        pass

class StudentConversation(Resource):
    def get(self, student_id):
        """Get student's conversation history.
        ---
        tags:
          - admin/students
        summary: Get student conversation history
        description: Get complete conversation history for a specific student
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            type: string
            required: true
            description: ID of the student
          - name: start_time
            in: query
            type: string
            format: date-time
            description: Filter conversations after this time
          - name: end_time
            in: query
            type: string
            format: date-time
            description: Filter conversations before this time
          - name: page
            in: query
            type: integer
            default: 1
            description: Page number
          - name: per_page
            in: query
            type: integer
            default: 50
            description: Conversations per page
        responses:
          200:
            description: Conversation history retrieved successfully
            schema:
              type: object
              properties:
                total:
                  type: integer
                conversations:
                  type: array
                  items:
                    type: object
                    properties:
                      timestamp:
                        type: string
                        format: date-time
                      role:
                        type: string
                        enum: [user, assistant]
                      content:
                        type: string
          401:
            description: Invalid or missing API key
          404:
            description: Student not found
        """
        pass

class StudentAnalysis(Resource):
    def get(self, student_id):
        """Get AI analysis and intervention suggestions.
        ---
        tags:
          - admin/students
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
    def put(self, student_id):
        """Update student follow-up status.
        ---
        tags:
          - admin/students
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

    def get(self, student_id):
        """Get student follow-up status history.
        ---
        tags:
          - admin/students
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
    def put(self, student_id):
        """Update student follow-up note.
        ---
        tags:
          - admin/students
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

    def get(self, student_id):
        """Get student follow-up note history.
        ---
        tags:
          - admin/students
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
api.add_resource(StudentConversation, '/students/<string:student_id>/conversation')
api.add_resource(StudentAnalysis, '/students/<string:student_id>/analysis')
api.add_resource(StudentStatus, '/students/<string:student_id>/status')
api.add_resource(StudentNote, '/students/<string:student_id>/note')

