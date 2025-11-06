"""
Web App Workflow Resume APIs.
"""

import logging
import time
from collections.abc import Generator

from flask import Response

from controllers.web import api
from controllers.web.wraps import WebApiResource

logger = logging.getLogger(__name__)


class WorkflowResumeWaitApi(WebApiResource):
    """API for long-polling workflow resume wait."""

    def get(self, task_id: str):
        """
        Get workflow execution resume notification.

        GET /api/workflow/<task_id>/resume-wait

        This is a long-polling API that waits for workflow to resume from paused state.
        """
        # TODO: Implement actual workflow status checking
        # For now, return a basic response

        timeout = 30  # 30 seconds timeout for demo
        start_time = time.time()

        while time.time() - start_time < timeout:
            # TODO: Check workflow status from database/cache
            # workflow_status = workflow_service.get_status(task_id)

            # For demo purposes, simulate different states
            # In real implementation, this would check the actual workflow state
            workflow_status = "paused"  # or "running" or "ended"

            if workflow_status == "running":
                return {"status": "running"}, 200
            elif workflow_status == "ended":
                return {"status": "ended"}, 200

            time.sleep(1)  # Poll every second

        # Return paused status if timeout reached
        return {"status": "paused"}, 200


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
