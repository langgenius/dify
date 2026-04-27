"""POST /openapi/v1/oauth/device/token — RFC 8628 device authorization
poll. Public; the CLI polls until the user completes approval at
/device.

The class is also registered on the legacy /v1/ namespace from
service_api/oauth.py until Phase F retires that mount.
"""
from __future__ import annotations

import logging

from flask import request
from flask_restx import Resource, reqparse

from controllers.openapi import openapi_ns
from extensions.ext_redis import redis_client
from libs.helper import extract_remote_ip
from services.oauth_device_flow import (
    DEFAULT_POLL_INTERVAL_SECONDS,
    DeviceFlowRedis,
    DeviceFlowStatus,
    SlowDownDecision,
)

logger = logging.getLogger(__name__)

_poll_parser = reqparse.RequestParser()
_poll_parser.add_argument("device_code", type=str, required=True, location="json")
_poll_parser.add_argument("client_id", type=str, required=True, location="json")


@openapi_ns.route("/oauth/device/token")
class OAuthDeviceTokenApi(Resource):
    """RFC 8628 poll."""

    def post(self):
        args = _poll_parser.parse_args()
        device_code = args["device_code"]

        store = DeviceFlowRedis(redis_client)

        # slow_down beats every other branch — polling-too-fast clients
        # see only that response regardless of underlying state.
        if store.record_poll(device_code, DEFAULT_POLL_INTERVAL_SECONDS) is SlowDownDecision.SLOW_DOWN:
            return {"error": "slow_down"}, 400

        state = store.load_by_device_code(device_code)
        if state is None:
            return {"error": "expired_token"}, 400

        if state.status is DeviceFlowStatus.PENDING:
            return {"error": "authorization_pending"}, 400

        terminal = store.consume_on_poll(device_code)
        if terminal is None:
            return {"error": "expired_token"}, 400

        if terminal.status is DeviceFlowStatus.DENIED:
            return {"error": "access_denied"}, 400

        poll_payload = terminal.poll_payload or {}
        if "token" not in poll_payload:
            logger.error("device_flow: approved state missing poll_payload for %s", device_code)
            return {"error": "expired_token"}, 400

        _audit_cross_ip_if_needed(state)
        return poll_payload, 200


def _audit_cross_ip_if_needed(state) -> None:
    poll_ip = extract_remote_ip(request)
    if state.created_ip and poll_ip and poll_ip != state.created_ip:
        logger.warning(
            "audit: oauth.device_code_cross_ip_poll token_id=%s creation_ip=%s poll_ip=%s",
            state.token_id, state.created_ip, poll_ip,
            extra={
                "audit": True,
                "token_id": state.token_id,
                "creation_ip": state.created_ip,
                "poll_ip": poll_ip,
            },
        )
