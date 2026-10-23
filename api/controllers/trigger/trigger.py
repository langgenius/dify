import logging
import re
from http import HTTPStatus

from flask import Response, jsonify, request

from controllers.common.access_response import plugin_endpoint_not_found_response
from controllers.trigger import bp
from extensions.ext_application_services import application_services
from services.trigger.endpoint_service import (
    TriggerEndpointEventNotFoundError,
    TriggerEndpointLoadError,
    TriggerEndpointProviderNotFoundError,
)

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
        response = application_services().workspaces.trigger_endpoints.process(endpoint_id, request)
        if response is None:
            response = application_services().workspaces.trigger_builders.process_builder_validation_endpoint(
                endpoint_id, request
            )
        if response is None:
            logger.info("Endpoint not found for %s", endpoint_id)
            return plugin_endpoint_not_found_response()
        return response
    except TriggerEndpointProviderNotFoundError:
        return Response(status=HTTPStatus.NOT_FOUND, response="Trigger provider not found")
    except TriggerEndpointLoadError:
        logger.exception("Failed to load trigger subscription for endpoint %s", endpoint_id)
        return Response(status=HTTPStatus.INTERNAL_SERVER_ERROR, response="Failed to get subscription by endpoint")
    except TriggerEndpointEventNotFoundError:
        return (
            jsonify({"error": "Endpoint processing failed", "message": "Plugin returned an undeclared trigger event."}),
            HTTPStatus.BAD_REQUEST,
        )
    except ValueError:
        logger.exception("Invalid webhook request or plugin response for endpoint %s", endpoint_id)
        return (
            jsonify({"error": "Endpoint processing failed", "message": "Invalid webhook request or plugin response."}),
            HTTPStatus.BAD_REQUEST,
        )
    except Exception:
        logger.exception("Webhook processing failed for %s", endpoint_id)
        return jsonify({"error": "Internal server error"}), HTTPStatus.INTERNAL_SERVER_ERROR
