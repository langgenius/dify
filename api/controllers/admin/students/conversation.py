import services
from controllers.admin import api
from controllers.admin.students.error import NotChatAppError
from controllers.admin.wraps import validate_admin_token_and_extract_info
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import conversation_infinite_scroll_pagination_fields
from flask_restful import Resource, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from libs.helper import uuid_value
from models.model import App, AppMode
from services.conversation_service import ConversationService
from services.end_user_service import EndUserService
from sqlalchemy.orm import Session  # type: ignore
from werkzeug.exceptions import NotFound


class StudentConversation(Resource):
    @validate_admin_token_and_extract_info
    @marshal_with(conversation_infinite_scroll_pagination_fields)
    def get(self, app_model: App, student_id: str):
        """Get student's conversation history.
        ---
        tags:
          - admin/api/students
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
        end_user = EndUserService.load_end_user_by_id(student_id)
        if not end_user:
            raise NotFound("Student not found")

        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("last_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        parser.add_argument(
            "sort_by",
            type=str,
            choices=["created_at", "-created_at", "updated_at", "-updated_at"],
            required=False,
            default="-updated_at",
            location="args",
        )
        args = parser.parse_args()

        try:
            with Session(db.engine) as session:
                return ConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=end_user,
                    last_id=args["last_id"],
                    limit=args["limit"],
                    invoke_from=InvokeFrom.SERVICE_API,
                    sort_by=args["sort_by"],
                )
        except services.errors.conversation.LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


api.add_resource(StudentConversation, '/students/<string:student_id>/conversation')
