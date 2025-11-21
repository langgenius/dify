"""
Web App Workflow Resume APIs.
"""

import logging
from collections.abc import Generator

from flask import Response

from controllers.web import api
from controllers.web.wraps import WebApiResource

logger = logging.getLogger(__name__)


class WorkflowEventsApi(WebApiResource):
    """API for getting workflow execution events after resume."""

    def get(self, task_id: str):
        """
        Get workflow execution events stream after resume.

        GET /api/workflow/<task_id>/events

        Returns Server-Sent Events stream.
        """

        def generate_events() -> Generator[str, None, None]:
            """Generate SSE events for workflow execution."""
            try:
                # TODO: Implement actual event streaming
                # This would connect to the workflow execution engine
                # and stream real-time events

                # For demo purposes, send a basic event
                yield f"data: {{'event': 'workflow_resumed', 'task_id': '{task_id}'}}\n\n"

                # In real implementation, this would:
                # 1. Connect to workflow execution engine
                # 2. Stream real-time execution events
                # 3. Handle client disconnection
                # 4. Clean up resources on completion

            except Exception as e:
                logger.exception("Error streaming events for task %s", task_id)
                yield f"data: {{'error': 'Stream error: {str(e)}'}}\n\n"

        return Response(
            generate_events(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )


# Register the APIs
api.add_resource(WorkflowResumeWaitApi, "/workflow/<string:task_id>/resume-wait")
api.add_resource(WorkflowEventsApi, "/workflow/<string:task_id>/events")
