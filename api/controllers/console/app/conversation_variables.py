from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.conversation_variable_fields import (
    conversation_variable_fields,
    paginated_conversation_variable_fields,
)
from libs.login import login_required
from models import ConversationVariable
from models.model import AppMode

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ConversationVariablesQuery(BaseModel):
    conversation_id: str = Field(..., description="Conversation ID to filter variables")


console_ns.schema_model(
    ConversationVariablesQuery.__name__,
    ConversationVariablesQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)

# Register models for flask_restx to avoid dict type issues in Swagger
# Register base model first
conversation_variable_model = console_ns.model("ConversationVariable", conversation_variable_fields)

# For nested models, need to replace nested dict with registered model
paginated_conversation_variable_fields_copy = paginated_conversation_variable_fields.copy()
paginated_conversation_variable_fields_copy["data"] = fields.List(
    fields.Nested(conversation_variable_model), attribute="data"
)
paginated_conversation_variable_model = console_ns.model(
    "PaginatedConversationVariable", paginated_conversation_variable_fields_copy
)


@console_ns.route("/apps/<uuid:app_id>/conversation-variables")
class ConversationVariablesApi(Resource):
    @console_ns.doc("get_conversation_variables")
    @console_ns.doc(description="Get conversation variables for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ConversationVariablesQuery.__name__])
    @console_ns.response(200, "Conversation variables retrieved successfully", paginated_conversation_variable_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.ADVANCED_CHAT)
    @marshal_with(paginated_conversation_variable_model)
    def get(self, app_model):
        args = ConversationVariablesQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        stmt = (
            select(ConversationVariable)
            .where(ConversationVariable.app_id == app_model.id)
            .order_by(ConversationVariable.created_at)
        )
        stmt = stmt.where(ConversationVariable.conversation_id == args.conversation_id)

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
