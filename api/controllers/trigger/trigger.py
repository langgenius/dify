import logging
import re

from flask import jsonify, request
from werkzeug.exceptions import NotFound

from controllers.trigger import bp
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from services.trigger_service import TriggerService

logger = logging.getLogger(__name__)

UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
UUID_MATCHER = re.compile(UUID_PATTERN)


@bp.route("/plugin/<string:endpoint_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def trigger_endpoint(endpoint_id: str):
    """
    Handle endpoint trigger calls.
    """
    # endpoint_id must be UUID
    if not UUID_MATCHER.match(endpoint_id):
        raise NotFound("Invalid endpoint ID")
    handling_chain = [
        TriggerService.process_endpoint,
        TriggerSubscriptionBuilderService.process_builder_validation_endpoint,
    ]
    try:
        for handler in handling_chain:
            response = handler(endpoint_id, request)
            if response:
                break
        if not response:
            raise NotFound("Endpoint not found")
        return response
    except ValueError as e:
        raise NotFound(str(e))
    except Exception as e:
        logger.exception("Webhook processing failed for {endpoint_id}")
        return jsonify({"error": "Internal server error", "message": str(e)}), 500
