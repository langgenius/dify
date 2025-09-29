import logging
import time

from flask import jsonify
from werkzeug.exceptions import NotFound, RequestEntityTooLarge

from controllers.trigger import bp
from services.trigger_debug_service import WebhookDebugService
from services.webhook_service import WebhookService

logger = logging.getLogger(__name__)


def _prepare_webhook_execution(webhook_id: str):
    """Fetch trigger context, extract request data, and validate payload."""
    webhook_trigger, workflow, node_config = WebhookService.get_webhook_trigger_and_workflow(webhook_id)
    webhook_data = WebhookService.extract_webhook_data(webhook_trigger)
    validation_result = WebhookService.validate_webhook_request(webhook_data, node_config)
    if not validation_result["valid"]:
        return webhook_trigger, workflow, node_config, webhook_data, validation_result["error"]

    return webhook_trigger, workflow, node_config, webhook_data, None


@bp.route("/webhook/<string:webhook_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def handle_webhook(webhook_id: str):
    """
    Handle webhook trigger calls.

    This endpoint receives webhook calls and processes them according to the
    configured webhook trigger settings.
    """
    try:
        webhook_trigger, workflow, node_config, webhook_data, error = _prepare_webhook_execution(webhook_id)
        if error:
            return jsonify({"error": "Bad Request", "message": error}), 400

        # Process webhook call (send to Celery)
        WebhookService.trigger_workflow_execution(webhook_trigger, webhook_data, workflow)

        # Return configured response
        response_data, status_code = WebhookService.generate_webhook_response(node_config)
        return jsonify(response_data), status_code

    except ValueError as e:
        raise NotFound(str(e))
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        logger.exception("Webhook processing failed for %s", webhook_id)
        return jsonify({"error": "Internal server error", "message": str(e)}), 500


@bp.route("/webhook-debug/<string:webhook_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def handle_webhook_debug(webhook_id: str):
    """Handle webhook debug calls without triggering production workflow execution."""
    try:
        webhook_trigger, workflow, node_config, webhook_data, error = _prepare_webhook_execution(webhook_id)
        if error:
            return jsonify({"error": "Bad Request", "message": error}), 400

        workflow_inputs = WebhookService.build_workflow_inputs(webhook_data)
        WebhookDebugService.dispatch_event(
            tenant_id=webhook_trigger.tenant_id,
            app_id=webhook_trigger.app_id,
            node_id=webhook_trigger.node_id,
            request_id=f"webhook_debug_{webhook_trigger.webhook_id}_{int(time.time() * 1000)}",
            timestamp=int(time.time()),
            payload={
                "inputs": workflow_inputs,
                "webhook_data": webhook_data,
                "method": webhook_data.get("method"),
            },
        )
        response_data, status_code = WebhookService.generate_webhook_response(node_config)
        return jsonify(response_data), status_code

    except ValueError as e:
        raise NotFound(str(e))
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        logger.exception("Webhook debug processing failed for %s", webhook_id)
        return jsonify({"error": "Internal server error", "message": str(e)}), 500
