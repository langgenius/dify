from datetime import datetime

from dateutil.parser import isoparse
from flask import request
from flask_restx import Resource, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.completion_app_log_fields import build_completion_app_log_pagination_model
from libs.login import login_required
from models import App
from models.model import AppMode
from services.completion_app_log_service import CompletionAppLogService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class CompletionAppLogQuery(BaseModel):
    status: str | None = Field(default=None, description="Message status filter")
    created_at__before: datetime | None = Field(default=None, description="Filter logs created before this timestamp")
    created_at__after: datetime | None = Field(default=None, description="Filter logs created after this timestamp")
    created_by_end_user_session_id: str | None = Field(default=None, description="Filter by end user ID")
    created_by_account: str | None = Field(default=None, description="Filter by account")
    page: int = Field(default=1, ge=1, le=99999, description="Page number (1-99999)")
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page (1-100)")

    @field_validator("created_at__before", "created_at__after", mode="before")
    @classmethod
    def parse_datetime(cls, value: str | None) -> datetime | None:
        if value in (None, ""):
            return None
        return isoparse(value)  # type: ignore


console_ns.schema_model(
    CompletionAppLogQuery.__name__,
    CompletionAppLogQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)

# Register model for flask_restx to avoid dict type issues in Swagger
completion_app_log_pagination_model = build_completion_app_log_pagination_model(console_ns)


@console_ns.route("/apps/<uuid:app_id>/completion-app-logs")
class CompletionAppLogApi(Resource):
    @console_ns.doc("get_completion_app_logs")
    @console_ns.doc(description="Get completion application execution logs with token consumption")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[CompletionAppLogQuery.__name__])
    @console_ns.response(200, "Completion app logs retrieved successfully", completion_app_log_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.COMPLETION])
    @marshal_with(completion_app_log_pagination_model)
    def get(self, app_model: App):
        """
        Get completion app logs with token consumption information
        """
        args = CompletionAppLogQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        # get paginate completion app logs
        completion_app_log_service = CompletionAppLogService()
        with Session(db.engine) as session:
            completion_app_log_pagination = completion_app_log_service.get_paginate_completion_app_logs(
                session=session,
                app_model=app_model,
                status=args.status,
                created_at_before=args.created_at__before,
                created_at_after=args.created_at__after,
                page=args.page,
                limit=args.limit,
                created_by_end_user_session_id=args.created_by_end_user_session_id,
                created_by_account=args.created_by_account,
            )

            return completion_app_log_pagination
