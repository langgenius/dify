"""
Web App Workflow Resume APIs.
"""

import json
from collections.abc import Generator

from flask import Response, request
from sqlalchemy.orm import sessionmaker

from controllers.web import api
from controllers.web.error import InvalidArgumentError, NotFoundError
from controllers.web.wraps import WebApiResource
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.message_generator import MessageGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from extensions.ext_database import db
from models.enums import CreatorUserRole
from models.model import App, AppMode, EndUser
from repositories.factory import DifyAPIRepositoryFactory
from services.workflow_event_snapshot_service import build_workflow_event_stream


class WorkflowEventsApi(WebApiResource):
    """API for getting workflow execution events after resume."""

    def get(self, app_model: App, end_user: EndUser, task_id: str):
        """
        Get workflow execution events stream after resume.

        GET /api/workflow/<task_id>/events

        Returns Server-Sent Events stream.
        """
        workflow_run_id = task_id
        session_maker = sessionmaker(db.engine)
        repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
        workflow_run = repo.get_workflow_run_by_id_and_tenant_id(
            tenant_id=app_model.tenant_id,
            run_id=workflow_run_id,
        )

        if workflow_run is None:
            raise NotFoundError(f"WorkflowRun not found, id={workflow_run_id}")

        if workflow_run.app_id != app_model.id:
            raise NotFoundError(f"WorkflowRun not found, id={workflow_run_id}")

        if workflow_run.created_by_role != CreatorUserRole.END_USER:
            raise NotFoundError(f"WorkflowRun not created by end user, id={workflow_run_id}")

        if workflow_run.created_by != end_user.id:
            raise NotFoundError(f"WorkflowRun not created by the current end user, id={workflow_run_id}")

        if workflow_run.finished_at is not None:
            response = WorkflowResponseConverter.workflow_run_result_to_finish_response(
                task_id=workflow_run.id,
                workflow_run=workflow_run,
                creator_user=end_user,
            )

            payload = response.model_dump(mode="json")
            payload["event"] = response.event.value

            def _generate_finished_events() -> Generator[str, None, None]:
                yield f"data: {json.dumps(payload)}\n\n"

            event_generator = _generate_finished_events
        else:
            app_mode = AppMode.value_of(app_model.mode)
            msg_generator = MessageGenerator()
            generator: BaseAppGenerator
            if app_mode == AppMode.ADVANCED_CHAT:
                generator = AdvancedChatAppGenerator()
            elif app_mode == AppMode.WORKFLOW:
                generator = WorkflowAppGenerator()
            else:
                raise InvalidArgumentError(f"cannot subscribe to workflow run, workflow_run_id={workflow_run.id}")

            include_state_snapshot = request.args.get("include_state_snapshot", "false").lower() == "true"

            def _generate_stream_events():
                if include_state_snapshot:
                    return generator.convert_to_event_stream(
                        build_workflow_event_stream(
                            app_mode=app_mode,
                            workflow_run=workflow_run,
                            tenant_id=app_model.tenant_id,
                            app_id=app_model.id,
                            session_maker=session_maker,
                        )
                    )
                return generator.convert_to_event_stream(
                    msg_generator.retrieve_events(app_mode, workflow_run.id),
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


# Register the APIs
api.add_resource(WorkflowEventsApi, "/workflow/<string:task_id>/events")
