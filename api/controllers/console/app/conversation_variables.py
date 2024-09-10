from flask_restful import Resource, marshal_with, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from fields.conversation_variable_fields import paginated_conversation_variable_fields
from libs.login import login_required
from models import ConversationVariable
from models.model import AppMode


class ConversationVariablesApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.ADVANCED_CHAT)
    @marshal_with(paginated_conversation_variable_fields)
    def get(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", type=str, location="args")
        args = parser.parse_args()

        stmt = (
            select(ConversationVariable)
            .where(ConversationVariable.app_id == app_model.id)
            .order_by(ConversationVariable.created_at)
        )
        if args["conversation_id"]:
            stmt = stmt.where(ConversationVariable.conversation_id == args["conversation_id"])
        else:
            raise ValueError("conversation_id is required")

        # NOTE: This is a temporary solution to avoid performance issues.
        page = 1
        page_size = 100
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)

        with Session(db.engine) as session:
            rows = session.scalars(stmt).all()

        return {
            "page": page,
            "limit": page_size,
            "total": len(rows),
            "has_more": False,
            "data": [
                {
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                    **row.to_variable().model_dump(),
                }
                for row in rows
            ],
        }


api.add_resource(ConversationVariablesApi, "/apps/<uuid:app_id>/conversation-variables")
