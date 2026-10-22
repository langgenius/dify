import logging
import re

from flask import Response, jsonify, request

from controllers.common.access_response import plugin_endpoint_not_found_response
from controllers.trigger import bp
from extensions.ext_application_services import application_services
from services.trigger.trigger_service import TriggerService

logger = logging.getLogger(__name__)

UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
UUID_MATCHER = re.compile(UUID_PATTERN)


@bp.route("/plugin/<string:endpoint_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def trigger_endpoint(endpoint_id: str) -> Response | tuple[Response, int]:
    """
    Handle endpoint trigger calls.
    """
    # endpoint_id must be UUID
    if not UUID_MATCHER.match(endpoint_id):
        return plugin_endpoint_not_found_response()
    try:
        response = TriggerService.process_endpoint(endpoint_id, request)
        if not response:
            response = application_services().workspaces.trigger_builders.process_builder_validation_endpoint(
                endpoint_id, request
            )
        if not response:
            logger.info("Endpoint not found for %s", endpoint_id)
            return plugin_endpoint_not_found_response()
        return response
    except ValueError as e:
        return jsonify({"error": "Endpoint processing failed", "message": str(e)}), 400
    except Exception:
        logger.exception("Webhook processing failed for %s", endpoint_id)
        return jsonify({"error": "Internal server error"}), 500
