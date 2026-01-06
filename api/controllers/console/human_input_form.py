"""
Console/Studio Human Input Form APIs.
"""

import json
import logging
from collections.abc import Generator

from flask import Response, jsonify
from flask_restx import Resource, reqparse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import InvalidArgumentError, NotFoundError
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.message_generator import MessageGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import App
from models.enums import CreatorUserRole
from models.human_input import RecipientType
from models.model import AppMode
from models.workflow import Workflow, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from services.human_input_service import Form, HumanInputService

logger = logging.getLogger(__name__)


def _jsonify_pydantic_model(model: BaseModel) -> Response:
    return Response(model.model_dump_json(), mimetype="application/json")


@console_ns.route("/form/human_input/<string:form_token>")
class ConsoleHumanInputFormApi(Resource):
    """Console API for getting human input form definition."""

    @staticmethod
    def _ensure_console_access(form: Form):
        current_user, current_tenant_id = current_account_with_tenant()

        workflow_run = db.session.get(WorkflowRun, form.workflow_run_id)
        if workflow_run is None or workflow_run.tenant_id != current_tenant_id:
            raise NotFoundError("Workflow run not found")

        if workflow_run.app_id:
            app = db.session.get(App, workflow_run.app_id)
            if app is None or app.tenant_id != current_tenant_id:
                raise NotFoundError("App not found")
            owner_account_id = app.created_by
        else:
            workflow = db.session.get(Workflow, workflow_run.workflow_id)
            if workflow is None or workflow.tenant_id != current_tenant_id:
                raise NotFoundError("Workflow not found")

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, form_token: str):
        """
        Get human input form definition by form token.

        GET /console/api/form/human_input/<form_token>
        """
        service = HumanInputService(db.engine)
        form = service.get_form_definition_by_token_for_console(form_token)
        if form is None:
            raise NotFoundError(f"form not found, token={form_token}")

        self._ensure_console_access(form)

        return _jsonify_pydantic_model(form.get_definition())

    @account_initialization_required
    @login_required
    def post(self, form_token: str):
        """
        Submit human input form by form token.

        POST /console/api/form/human_input/<form_token>

        Request body:
        {
            "inputs": {
                "content": "User input content"
            },
            "action": "Approve"
        }
        """
        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("action", type=str, required=True, location="json")
        args = parser.parse_args()
        current_user, _ = current_account_with_tenant()

        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            raise NotFoundError(f"form not found, token={form_token}")

        self._ensure_console_access(form)

        recipient_type = form.recipient_type
        if recipient_type != RecipientType.CONSOLE:
            raise NotFoundError(f"form not found, token={form_token}")

        service.submit_form_by_token(
            recipient_type=RecipientType.CONSOLE,
            form_token=form_token,
            selected_action_id=args["action"],
            form_data=args["inputs"],
            submission_user_id=current_user.id,
        )

        return jsonify({})


@console_ns.route("/workflow/<string:workflow_run_id>/events")
class ConsoleWorkflowEventsApi(Resource):
    """Console API for getting workflow execution events after resume."""

    @account_initialization_required
    @login_required
    def get(self, workflow_run_id: str):
        """
        Get workflow execution events stream after resume.

        GET /console/api/workflow/<workflow_run_id>/events

        Returns Server-Sent Events stream.
        """

        user, tenant_id = current_account_with_tenant()
        session_maker = sessionmaker(db.engine)
        repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
        workflow_run = repo.get_workflow_run_by_id_and_tenant_id(
            tenant_id=tenant_id,
            run_id=workflow_run_id,
        )
        if workflow_run is None:
            raise NotFoundError(f"WorkflowRun not found, id={workflow_run_id}")

        if workflow_run.created_by_role != CreatorUserRole.ACCOUNT:
            raise NotFoundError(f"WorkflowRun not created by account, id={workflow_run_id}")

        if workflow_run.created_by != user.id:
            raise NotFoundError(f"WorkflowRun not created by the current account, id={workflow_run_id}")

        with Session(expire_on_commit=False, bind=db.engine) as session:
            app = _retrieve_app_for_workflow_run(session, workflow_run)

        if workflow_run.finished_at is not None:
            # TODO(QuantumGhost): should we modify the handling for finished workflow run here?
            response = WorkflowResponseConverter.workflow_run_result_to_finish_response(
                task_id=workflow_run.id,
                workflow_run=workflow_run,
                creator_user=user,
            )

            payload = response.model_dump(mode="json")
            payload["event"] = response.event.value

            def _generate_finished_events() -> Generator[str, None, None]:
                yield f"data: {json.dumps(payload)}\n\n"

            event_generator = _generate_finished_events

        else:
            msg_generator = MessageGenerator()
            if app.mode == AppMode.ADVANCED_CHAT:
                generator = AdvancedChatAppGenerator()
            elif app.mode == AppMode.WORKFLOW:
                generator = WorkflowAppGenerator()
            else:
                raise InvalidArgumentError(f"cannot subscribe to workflow run, workflow_run_id={workflow_run.id}")

            def _generate_stream_events():
                return generator.convert_to_event_stream(
                    msg_generator.retrieve_events(AppMode(app.mode), workflow_run.id),
                )

            event_generator = _generate_stream_events

        return Response(
            event_generator(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )


def _retrieve_app_for_workflow_run(session: Session, workflow_run: WorkflowRun):
    query = select(App).where(
        App.id == workflow_run.app_id,
        App.tenant_id == workflow_run.tenant_id,
    )
    app = session.scalars(query).first()
    if app is None:
        raise AssertionError(
            f"App not found for WorkflowRun, workflow_run_id={workflow_run.id}, "
            f"app_id={workflow_run.app_id}, tenant_id={workflow_run.tenant_id}"
        )

    return app
