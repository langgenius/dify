"""Bounded, unauthenticated HTTP transport for Provider-authenticated callbacks."""

from typing import Annotated

from flask import Blueprint, Response, request
from pydantic import BaseModel, Field, ValidationError

from configs import dify_config
from core.human_input_v2.im_integration.adapters.entities import WebhookRequest
from libs.datetime_utils import naive_utc_now
from repositories.human_input_v2.im_channel_repository import WebhookId
from services.human_input_v2.im_webhook_runtime import build_im_webhook_ingress_service

bp = Blueprint("im_provider_webhook", __name__, url_prefix="/callbacks/human-input/v2/im")


class _WebhookRoute(BaseModel):
    webhook_id: Annotated[str, Field(min_length=32, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")]


@bp.post("/<webhook_id>")
def handle_im_provider_webhook(webhook_id: str) -> Response:
    received_at = naive_utc_now()
    try:
        route = _WebhookRoute(webhook_id=webhook_id)
    except ValidationError:
        return Response(status=404)
    maximum_bytes = dify_config.WEBHOOK_REQUEST_BODY_MAX_SIZE
    if request.content_length is not None and request.content_length > maximum_bytes:
        return Response(status=413)
    body = request.stream.read(maximum_bytes + 1)
    if len(body) > maximum_bytes:
        return Response(status=413)
    provider_response = build_im_webhook_ingress_service().handle(
        WebhookId(route.webhook_id),
        WebhookRequest(
            method=request.method,
            headers=tuple(request.headers.items()),
            body=body,
            received_at=received_at,
        ),
    )
    return Response(provider_response.body, status=provider_response.status_code, headers=provider_response.headers)
