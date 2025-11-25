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
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import InvalidArgumentError, NotFoundError
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.message_generator import MessageGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.workflow.nodes.human_input.entities import FormDefinition
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import App
from models.enums import CreatorUserRole
from models.human_input import HumanInputForm as HumanInputFormModel
from models.model import AppMode
from models.workflow import Workflow, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from services.human_input_service import HumanInputService

logger = logging.getLogger(__name__)


class _FormDefinitionWithSite(FormDefinition):
    # the site field may be not necessary for console scenario.
    site: None


def _jsonify_pydantic_model(model: BaseModel) -> Response:
    return Response(model.model_dump_json(), mimetype="application/json")


@console_ns.route("/form/human_input/<string:form_id>")
class ConsoleHumanInputFormApi(Resource):
    """Console API for getting human input form definition."""

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, form_id: str):
        """
        Get human input form definition by form ID.

        GET /console/api/form/human_input/<form_id>
        """
        service = HumanInputService(db.engine)
        form = service.get_form_definition_by_id(
            form_id=form_id,
        )
        if form is None:
            raise NotFoundError(f"form not found, id={form_id}")

        current_user, current_tenant_id = current_account_with_tenant()
        form_model = db.session.get(HumanInputFormModel, form_id)
        if form_model is None or form_model.tenant_id != current_tenant_id:
            raise NotFoundError(f"form not found, id={form_id}")

        workflow_run = db.session.get(WorkflowRun, form_model.workflow_run_id)
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
            owner_account_id = workflow.created_by

        if owner_account_id != current_user.id:
            raise Forbidden("You do not have permission to access this human input form.")

        return _jsonify_pydantic_model(form.get_definition())

    @account_initialization_required
    @login_required
    def post(self, form_id: str):
        """
        Submit human input form by form ID.

        POST /console/api/form/human_input/<form_id>

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

        # Submit the form
        service = HumanInputService(db.engine)
        service.submit_form_by_id(
            form_id=form_id,
            selected_action_id=args["action"],
            form_data=args["inputs"],
            user=current_user,
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
            response = WorkflowResponseConverter.workflow_run_result_to_finish_response(
                task_id=workflow_run.id,
                workflow_run=workflow_run,
                creator_user=user,
            )

            payload = response.model_dump(mode="json")
            payload["event"] = response.event.value

            def generate_events() -> Generator[str, None, None]:
                yield f"data: {json.dumps(payload)}\n\n"

        else:
            msg_generator = MessageGenerator()
            if app.mode == AppMode.ADVANCED_CHAT:
                generator = AdvancedChatAppGenerator()
            elif app.mode == AppMode.WORKFLOW:
                generator = WorkflowAppGenerator()
            else:
                raise InvalidArgumentError(f"cannot subscribe to workflow run, workflow_run_id={workflow_run.id}")

            def generate_events():
                return generator.convert_to_event_stream(
                    msg_generator.retrieve_events(AppMode(app.mode), workflow_run.id),
                )

        return Response(
            generate_events(),
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
