import logging
import time
from http import HTTPStatus

from flask import jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.wrappers import Response

from controllers.common.access_response import webhook_not_found_response
from controllers.trigger import bp
from controllers.trigger.webhook_request import WebhookRequestParser, WebhookRequestValidationError
from enums import QuotaType
from extensions.ext_application_services import application_services
from models.utils.trigger_endpoint import generate_webhook_trigger_endpoint
from services.errors.app import QuotaExceededError
from services.trigger.debug_events import WebhookDebugEvent
from services.trigger.webhook_service import WebhookContext, WebhookNotFoundError, build_webhook_workflow_inputs

logger = logging.getLogger(__name__)

_QUOTA_EXCEEDED_MESSAGES = {
    QuotaType.TRIGGER: "Trigger event quota exceeded. Please upgrade your plan.",
    QuotaType.WORKFLOW: "Workflow execution quota exceeded. Please upgrade your plan.",
}
_DEFAULT_QUOTA_EXCEEDED_MESSAGE = "Quota exceeded. Please upgrade your plan."


def _get_quota_exceeded_message(feature: str) -> str:
    try:
        quota_type = QuotaType(feature)
    except ValueError:
        return _DEFAULT_QUOTA_EXCEEDED_MESSAGE
    return _QUOTA_EXCEEDED_MESSAGES.get(quota_type, _DEFAULT_QUOTA_EXCEEDED_MESSAGE)


def _prepare_webhook_execution(webhook_id: str, *, debug: bool) -> tuple[WebhookContext, WebhookRequestParser]:
    services = application_services().triggers
    context = services.webhooks.prepare(webhook_id=webhook_id, debug=debug)
    parser = WebhookRequestParser(
        request=request,
        files=services.webhook_files,
        resolve_actor=lambda webhook_trigger: services.webhooks.resolve_actor(context=webhook_trigger),
    )
    return context, parser


@bp.route("/webhook/<string:webhook_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def handle_webhook(webhook_id: str) -> Response | tuple[Response, int]:
    """
    Handle webhook trigger calls.

    This endpoint receives webhook calls and processes them according to the
    configured webhook trigger settings.
    """
    try:
        context, parser = _prepare_webhook_execution(webhook_id, debug=False)
        try:
            webhook_data = parser.extract_and_validate_webhook_data(context, context.node_config)
        except WebhookRequestValidationError as error:
            return jsonify({"error": "Bad Request", "message": error.public_message}), HTTPStatus.BAD_REQUEST

        # Process webhook call (send to Celery)
        application_services().triggers.webhooks.execute(context=context, data=webhook_data, actor=parser.actor)

        # Return configured response
        response_data, status_code = parser.generate_webhook_response(context.node_config)
        return jsonify(response_data), status_code

    except QuotaExceededError as error:
        return jsonify(
            {
                "error": "Too Many Requests",
                "message": _get_quota_exceeded_message(error.feature),
            }
        ), HTTPStatus.TOO_MANY_REQUESTS
    except WebhookNotFoundError:
        return webhook_not_found_response()
    except RequestEntityTooLarge:
        raise
    except Exception:
        logger.exception("Webhook processing failed for %s", webhook_id)
        return jsonify(
            {"error": "Internal server error", "message": "An internal error has occurred."}
        ), HTTPStatus.INTERNAL_SERVER_ERROR


@bp.route("/webhook-debug/<string:webhook_id>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def handle_webhook_debug(webhook_id: str) -> Response | tuple[Response, int]:
    """Handle webhook debug calls without triggering production workflow execution.

    The debug webhook endpoint is only for draft inspection flows. It never enqueues
    Celery work for the published workflow; instead it dispatches an in-memory debug
    event to an active Variable Inspector listener. Returning a clear error when no
    listener is registered prevents a misleading 200 response for requests that are
    effectively dropped.
    """
    try:
        context, parser = _prepare_webhook_execution(webhook_id, debug=True)
        try:
            webhook_data = parser.extract_and_validate_webhook_data(context, context.node_config)
        except WebhookRequestValidationError as error:
            return jsonify({"error": "Bad Request", "message": error.public_message}), HTTPStatus.BAD_REQUEST

        workflow_inputs = build_webhook_workflow_inputs(webhook_data)

        event = WebhookDebugEvent(
            request_id=f"webhook_debug_{context.webhook_id}_{int(time.time() * 1000)}",
            timestamp=int(time.time()),
            node_id=context.node_id,
            payload={
                "inputs": workflow_inputs,
                "webhook_data": webhook_data,
                "method": webhook_data.get("method"),
            },
        )
        dispatch_count = application_services().triggers.debug.dispatch_webhook_debug(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            event=event,
        )
        if dispatch_count == 0:
            logger.warning(
                "Webhook debug request dropped without an active listener for webhook %s (tenant=%s, app=%s, node=%s)",
                context.webhook_id,
                context.tenant_id,
                context.app_id,
                context.node_id,
            )
            return (
                jsonify(
                    {
                        "error": "No active debug listener",
                        "message": (
                            "The webhook debug URL only works while the Variable Inspector is listening. "
                            "Use the published webhook URL to execute the workflow in Celery."
                        ),
                        "execution_url": generate_webhook_trigger_endpoint(context.webhook_id),
                    }
                ),
                HTTPStatus.CONFLICT,
            )
        response_data, status_code = parser.generate_webhook_response(context.node_config)
        return jsonify(response_data), status_code

    except WebhookNotFoundError:
        return webhook_not_found_response()
    except RequestEntityTooLarge:
        raise
    except Exception:
        logger.exception("Webhook debug processing failed for %s", webhook_id)
        return jsonify(
            {"error": "Internal server error", "message": "An internal error has occurred."}
        ), HTTPStatus.INTERNAL_SERVER_ERROR
