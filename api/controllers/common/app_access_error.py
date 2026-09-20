"""Attach request-local IP metadata to Web and Console app-not-found responses.

This transport hook runs after Flask-RESTX has formatted errors, including errors
with their own ``data`` payload. It deliberately does not change error ownership,
authentication, status codes, or unmatched-route handling.
"""

from typing import Literal

from flask import Blueprint, Response, current_app, request

from configs import dify_config
from core.network_access.client_ip import NetworkAccessClientIPUnavailableError, resolve_network_access_client_ip

_APP_IDENTITY_ROUTES = {
    "web": frozenset({"/site", "/parameters", "/meta", "/passport", "/login/status", "/webapp/access-mode"}),
    "console": frozenset(
        {
            "/apps/<uuid:app_id>",
            "/agent/<uuid:agent_id>",
            "/installed-apps/<uuid:installed_app_id>",
            "/installed-apps/<uuid:installed_app_id>/parameters",
            "/installed-apps/<uuid:installed_app_id>/meta",
            "/trial-apps/<uuid:app_id>",
            "/trial-apps/<uuid:app_id>/parameters",
        }
    ),
}


def register_app_access_error_metadata(blueprint: Blueprint, *, surface: Literal["web", "console"]) -> None:
    """Enrich only typed app 404s and GET app-identity 404s on this blueprint.

    Use matched route rules instead of caller-supplied paths or IDs. A missing
    app does not have an App model, and unrelated resource/form 404s must retain
    their existing response contracts. This hook is not registered on Service,
    Inner, or other APIs.
    """
    prefix = (blueprint.url_prefix or "").rstrip("/")
    identity_rules = frozenset(prefix + route for route in _APP_IDENTITY_ROUTES[surface])

    @blueprint.after_request
    def add_app_access_error_metadata(response: Response) -> Response:
        if (
            response.status_code != 404
            or response.is_streamed
            or response.direct_passthrough
            or not response.is_json
            or request.url_rule is None
            # HITL forms own their expiry/not-found UI, even if an underlying
            # app lookup happened to produce the typed app error.
            or request.url_rule.rule.startswith((prefix + "/form/human_input/", prefix + "/human-input-forms/"))
        ):
            return response

        payload = response.get_json(silent=True)
        if not isinstance(payload, dict):
            return response
        is_app_identity = request.method == "GET" and request.url_rule.rule in identity_rules
        if payload.get("code") != "app_not_found" and not is_app_identity:
            return response

        # An app 404 can be cached by URL, but its client address cannot be.
        response.headers["Cache-Control"] = "no-store"
        # This hook owns the metadata: never preserve an unverified address
        # supplied by an existing payload when trusted resolution is unavailable.
        payload.pop("client_ip", None)
        trusted_proxy_cidrs = dify_config.NETWORK_ACCESS_TRUSTED_PROXY_CIDRS
        # Never mislabel an internal Docker/ALB peer as the user's address when
        # deployment trust configuration is missing.
        if trusted_proxy_cidrs.strip():
            try:
                payload["client_ip"] = resolve_network_access_client_ip(request.environ, trusted_proxy_cidrs)
            except NetworkAccessClientIPUnavailableError:
                # Optional display metadata must not turn a genuine 404 into 503.
                pass

        response.set_data(current_app.json.dumps(payload))
        return response
