"""
OpenAPI bearer-authed workflow reconnect event stream endpoint.

GET /apps/<app_id>/tasks/<task_id>/events
  — reconnect to the SSE stream for a paused/running workflow run.
  `task_id` is treated as `workflow_run_id`.
"""

from __future__ import annotations

import json
from collections.abc import Generator

from flask import Response, request
from flask_restx import Resource
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound, UnprocessableEntity

from controllers.openapi import openapi_ns
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.message_generator import MessageGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.task_entities import StreamEvent
from core.workflow.human_input_policy import HumanInputSurface
from extensions.ext_database import db
from libs.oauth_bearer import Scope
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.factory import DifyAPIRepositoryFactory
from services.workflow_event_snapshot_service import build_workflow_event_stream


@openapi_ns.route("/apps/<string:app_id>/tasks/<string:task_id>/events")
class OpenApiWorkflowEventsApi(Resource):
    @openapi_ns.response(200, "SSE event stream")
    @auth_router.guard(scope=Scope.APPS_RUN)
    def get(self, app_id: str, task_id: str, *, auth_data: AuthData):
        app_model, caller, caller_kind = auth_data.require_app_context()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
            raise UnprocessableEntity("mode_not_supported_for_event_reconnect")

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

        if caller_kind == "account":
            if workflow_run.created_by_role != CreatorUserRole.ACCOUNT or workflow_run.created_by != caller.id:
                raise NotFound("Workflow run not found")
        else:
            if workflow_run.created_by_role != CreatorUserRole.END_USER or workflow_run.created_by != caller.id:
                raise NotFound("Workflow run not found")

        workflow_run_entity = workflow_run

        if workflow_run_entity.finished_at is not None:
            response = WorkflowResponseConverter.workflow_run_result_to_finish_response(
                task_id=workflow_run_entity.id,
                workflow_run=workflow_run_entity,
                creator_user=caller,
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
            else:
                generator = WorkflowAppGenerator()

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
                            human_input_surface=HumanInputSurface.OPENAPI,
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
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
