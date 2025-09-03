import logging

from flask import jsonify
from werkzeug.exceptions import NotFound

from controllers.trigger import bp
from services.webhook_service import WebhookService

logger = logging.getLogger(__name__)


@bp.route("/webhook/<string:webhook_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
@bp.route("/webhook-debug/<string:webhook_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def handle_webhook(webhook_id: str):
    """
    Handle webhook trigger calls.

    This endpoint receives webhook calls and processes them according to the
    configured webhook trigger settings.
    """
    try:
        # Get webhook trigger, workflow, and node configuration
        webhook_trigger, workflow, node_config = WebhookService.get_webhook_trigger_and_workflow(webhook_id)

        # Extract request data
        webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

        # Validate request against node configuration
        validation_result = WebhookService.validate_webhook_request(webhook_data, node_config)
        if not validation_result["valid"]:
            return jsonify({"error": "Bad Request", "message": validation_result["error"]}), 400

        # Process webhook call (send to Celery)
        WebhookService.trigger_workflow_execution(webhook_trigger, webhook_data, workflow)

        # Return configured response
        response_data, status_code = WebhookService.generate_webhook_response(node_config)
        return jsonify(response_data), status_code

    except ValueError as e:
        raise NotFound(str(e))
    except Exception as e:
        logger.exception("Webhook processing failed for %s", webhook_id)
        return jsonify({"error": "Internal server error", "message": str(e)}), 500
