import logging

from flask import jsonify, request
from werkzeug.exceptions import NotFound

from controllers.trigger import bp
from services.trigger_service import TriggerService

logger = logging.getLogger(__name__)


@bp.route("/trigger/webhook/<string:endpoint_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def trigger_webhook(endpoint_id: str):
    """
    Handle webhook trigger calls.
    """
    try:
        return TriggerService.process_webhook(endpoint_id, request)
    except ValueError as e:
        raise NotFound(str(e))
    except Exception as e:
        logger.exception("Webhook processing failed for {endpoint_id}")
        return jsonify({"error": "Internal server error", "message": str(e)}), 500
