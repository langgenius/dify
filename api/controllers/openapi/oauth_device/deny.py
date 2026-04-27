"""POST /openapi/v1/oauth/device/deny — user denies a pending device
flow from the /device page. Console-session authed.

The class is also registered on console_ns at /console/api/oauth/device/deny
from console/auth/oauth_device.py until Phase F retires that mount.
"""
from __future__ import annotations

import logging

from flask_login import login_required
from flask_restx import Resource, reqparse

from controllers.console.wraps import account_initialization_required, setup_required
from controllers.openapi import openapi_ns
from extensions.ext_redis import redis_client
from libs.oauth_bearer import bearer_feature_required
from libs.rate_limit import LIMIT_APPROVE_CONSOLE, rate_limit
from services.oauth_device_flow import (
    DeviceFlowRedis,
    DeviceFlowStatus,
    InvalidTransition,
    StateNotFound,
)

logger = logging.getLogger(__name__)


_mutate_parser = reqparse.RequestParser()
_mutate_parser.add_argument("user_code", type=str, required=True, location="json")


@openapi_ns.route("/oauth/device/deny")
class DeviceDenyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @bearer_feature_required
    @rate_limit(LIMIT_APPROVE_CONSOLE)
    def post(self):
        args = _mutate_parser.parse_args()
        user_code = args["user_code"].strip().upper()

        store = DeviceFlowRedis(redis_client)
        found = store.load_by_user_code(user_code)
        if found is None:
            return {"error": "expired_or_unknown"}, 404
        device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return {"error": "already_resolved"}, 409

        try:
            store.deny(device_code)
        except (StateNotFound, InvalidTransition) as e:
            logger.error("device_flow: deny raced on %s: %s", device_code, e)
            return {"error": "state_lost"}, 409

        _emit_deny_audit(state)
        return {"status": "denied"}, 200


def _emit_deny_audit(state) -> None:
    logger.warning(
        "audit: oauth.device_flow_denied client_id=%s device_label=%s",
        state.client_id, state.device_label,
        extra={
            "audit": True,
            "event": "oauth.device_flow_denied",
            "client_id": state.client_id,
            "device_label": state.device_label,
        },
    )


# Legacy /console/api/oauth/device/deny mount — handler defined above.
# Removed in Phase F. The console_ns import is local to defer past
# circular-import resolution between this module and controllers.console.
def _register_legacy_console_mount() -> None:
    from controllers.console import console_ns
    console_ns.add_resource(DeviceDenyApi, "/oauth/device/deny")


_register_legacy_console_mount()
