import logging
import time

from flask import jsonify
from werkzeug.exceptions import NotFound, RequestEntityTooLarge

from controllers.trigger import bp
from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.events import WebhookDebugEvent, build_webhook_pool_key
from services.trigger.webhook_service import WebhookService

logger = logging.getLogger(__name__)


def _prepare_webhook_execution(webhook_id: str, is_debug: bool = False):
    """Fetch trigger context, extract request data, and validate payload using unified processing.

    Args:
        webhook_id: The webhook ID to process
        is_debug: If True, skip status validation for debug mode
    """
    webhook_trigger, workflow, node_config = WebhookService.get_webhook_trigger_and_workflow(
        webhook_id, is_debug=is_debug
    )

    try:
        # Use new unified extraction and validation
        webhook_data = WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)
        return webhook_trigger, workflow, node_config, webhook_data, None
    except ValueError as e:
        # Fall back to raw extraction for error reporting
        webhook_data = WebhookService.extract_webhook_data(webhook_trigger)
        return webhook_trigger, workflow, node_config, webhook_data, str(e)


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
        webhook_trigger, _, node_config, webhook_data, error = _prepare_webhook_execution(webhook_id, is_debug=True)
        if error:
            return jsonify({"error": "Bad Request", "message": error}), 400

        workflow_inputs = WebhookService.build_workflow_inputs(webhook_data)

        # Generate pool key and dispatch debug event
        pool_key: str = build_webhook_pool_key(
            tenant_id=webhook_trigger.tenant_id,
            app_id=webhook_trigger.app_id,
            node_id=webhook_trigger.node_id,
        )
        event = WebhookDebugEvent(
            request_id=f"webhook_debug_{webhook_trigger.webhook_id}_{int(time.time() * 1000)}",
            timestamp=int(time.time()),
            node_id=webhook_trigger.node_id,
            payload={
                "inputs": workflow_inputs,
                "webhook_data": webhook_data,
                "method": webhook_data.get("method"),
            },
        )
        TriggerDebugEventBus.dispatch(
            tenant_id=webhook_trigger.tenant_id,
            event=event,
            pool_key=pool_key,
        )
        response_data, status_code = WebhookService.generate_webhook_response(node_config)
        return jsonify(response_data), status_code

    except ValueError as e:
        raise NotFound(str(e))
    except RequestEntityTooLarge:
        raise
    except Exception as e:
        logger.exception("Webhook debug processing failed for %s", webhook_id)
        return jsonify({"error": "Internal server error", "message": "An internal error has occurred."}), 500
