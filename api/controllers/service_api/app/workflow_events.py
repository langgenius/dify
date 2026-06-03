"""
Service API workflow resume event stream endpoints.
"""

import json
from collections.abc import Generator

from flask import Response, request
from flask_restx import Resource
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotWorkflowAppError
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.message_generator import MessageGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.task_entities import StreamEvent
from core.workflow.human_input_policy import HumanInputSurface
from extensions.ext_database import db
from models.enums import CreatorUserRole
from models.model import App, AppMode, EndUser
from repositories.factory import DifyAPIRepositoryFactory
from services.workflow_event_snapshot_service import build_workflow_event_stream


@service_api_ns.route("/workflow/<string:task_id>/events")
class WorkflowEventsApi(Resource):
    """Service API for getting workflow execution events after resume."""

    @service_api_ns.doc("get_workflow_events")
    @service_api_ns.doc(description="Get workflow execution events stream after resume")
    @service_api_ns.doc(
        params={
            "task_id": "Workflow run ID",
            "user": "End user identifier (query param)",
            "include_state_snapshot": (
                "Whether to replay from persisted state snapshot, "
                'specify `"true"` to include a status snapshot of executed nodes'
            ),
            "continue_on_pause": (
                "Whether to keep the stream open across workflow_paused events,"
                'specify `"true"` to keep the stream open for `workflow_paused` events.'
            ),
        }
    )
    @service_api_ns.doc(
        responses={
            200: "SSE event stream",
            401: "Unauthorized - invalid API token",
            404: "Workflow run not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True))
    def get(self, app_model: App, end_user: EndUser, task_id: str):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
            raise NotWorkflowAppError()

        session_maker = sessionmaker(db.engine)
        repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
        workflow_run = repo.get_workflow_run_by_id_and_tenant_id(
            tenant_id=app_model.tenant_id,
            run_id=task_id,
        )

        if workflow_run is None:
            raise NotFound("Workflow run not found")

        if workflow_run.app_id != app_model.id:
            raise NotFound("Workflow run not found")

        if workflow_run.created_by_role != CreatorUserRole.END_USER:
            raise NotFound("Workflow run not found")

        if workflow_run.created_by != end_user.id:
            raise NotFound("Workflow run not found")

        workflow_run_entity = workflow_run

        if workflow_run_entity.finished_at is not None:
            response = WorkflowResponseConverter.workflow_run_result_to_finish_response(
                task_id=workflow_run_entity.id,
                workflow_run=workflow_run_entity,
                creator_user=end_user,
            )

            payload = response.model_dump(mode="json")
            payload["event"] = response.event.value

            def _generate_finished_events() -> Generator[str, None, None]:
                yield f"data: {json.dumps(payload)}\n\n"

            event_generator = _generate_finished_events
        else:
            msg_generator = MessageGenerator()
            generator: BaseAppGenerator
            if app_mode == AppMode.ADVANCED_CHAT:
                generator = AdvancedChatAppGenerator()
            elif app_mode == AppMode.WORKFLOW:
                generator = WorkflowAppGenerator()
            else:
                raise NotWorkflowAppError()

            include_state_snapshot = request.args.get("include_state_snapshot", "false").lower() == "true"
            continue_on_pause = request.args.get("continue_on_pause", "false").lower() == "true"
            terminal_events: list[StreamEvent] | None = [] if continue_on_pause else None

            def _generate_stream_events():
                if include_state_snapshot:
                    return generator.convert_to_event_stream(
                        build_workflow_event_stream(
                            app_mode=app_mode,
                            workflow_run=workflow_run_entity,
                            tenant_id=app_model.tenant_id,
                            app_id=app_model.id,
                            session_maker=session_maker,
                            human_input_surface=HumanInputSurface.SERVICE_API,
                            close_on_pause=not continue_on_pause,
                        )
                    )
                return generator.convert_to_event_stream(
                    msg_generator.retrieve_events(
                        app_mode,
                        workflow_run_entity.id,
                        terminal_events=terminal_events,
                    ),
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
