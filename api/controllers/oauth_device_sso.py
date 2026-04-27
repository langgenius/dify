"""Legacy /v1/* mounts for SSO-branch device-flow endpoints. Canonical
handlers live in controllers/openapi/oauth_device/. This file just
re-registers them on the legacy blueprint until Phase F retires the
legacy paths entirely.

Note: /v1/device/sso-complete (no /oauth/ in the path) is the existing
ACS callback. Its canonical home is /openapi/v1/oauth/device/sso-complete.
IdP-side ACS callback URLs need re-registration before Phase F.
"""
from __future__ import annotations

from flask import Blueprint

from controllers.openapi.oauth_device.approval_context import approval_context
from controllers.openapi.oauth_device.approve_external import approve_external
from controllers.openapi.oauth_device.sso_complete import sso_complete
from controllers.openapi.oauth_device.sso_initiate import sso_initiate
from libs.device_flow_security import attach_anti_framing

bp = Blueprint("oauth_device_sso", __name__, url_prefix="/v1")
attach_anti_framing(bp)

# Legacy /v1/* mounts — handlers live in controllers/openapi/oauth_device/.
# Removed in Phase F.
bp.add_url_rule(
    "/oauth/device/sso-initiate",
    endpoint="sso_initiate",
    view_func=sso_initiate,
    methods=["GET"],
)
bp.add_url_rule(
    "/device/sso-complete",
    endpoint="sso_complete",
    view_func=sso_complete,
    methods=["GET"],
)
bp.add_url_rule(
    "/oauth/device/approval-context",
    endpoint="approval_context",
    view_func=approval_context,
    methods=["GET"],
)
bp.add_url_rule(
    "/oauth/device/approve-external",
    endpoint="approve_external",
    view_func=approve_external,
    methods=["POST"],
)
