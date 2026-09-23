"""Keep public App failures indistinguishable from Gateway policy denials.

This transport hook runs after Flask-RESTX has formatted errors, including errors
with their own ``data`` payload. Web App identity errors use a minimal canonical
404; Console keeps its existing error ownership and only receives IP metadata.
Unrelated resources and authentication failures retain their own contracts.
"""

from collections.abc import Mapping
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

_UNAVAILABLE_APP_CODES = frozenset({"app_unavailable", "agent_not_published"})


def _canonical_json(response: Response, payload: Mapping[str, object]) -> Response:
    """Match Gateway JSON bytes as well as its error status/header contract."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Type"] = "application/json"
    response.set_data(current_app.json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    return response


def register_app_access_error_metadata(blueprint: Blueprint, *, surface: Literal["web", "console"]) -> None:
    """Normalize Web App identity failures, without masking dependency errors.

    Use matched route rules instead of caller-supplied paths or IDs. A missing
    app does not have an App model. HITL keeps its native form/token errors rather
    than being reclassified as an App error. This hook is not registered on
    Service, Inner, or other APIs.
    """
    prefix = (blueprint.url_prefix or "").rstrip("/")
    identity_rules = frozenset(prefix + route for route in _APP_IDENTITY_ROUTES[surface])

    @blueprint.after_request
    def add_app_access_error_metadata(response: Response) -> Response:
        # Most responses cannot be changed by this hook. Avoid decoding successful
        # payloads (including large application data) or unrelated error bodies.
        status = response.status_code
        if status != 404 and (surface != "web" or status not in (400, 403)):
            return response
        if response.is_streamed or response.direct_passthrough or not response.is_json or request.url_rule is None:
            return response

        rule = request.url_rule.rule
        is_app_identity = request.method == "GET" and rule in identity_rules
        is_hitl = rule.startswith((prefix + "/form/human_input/", prefix + "/human-input-forms/"))
        if is_hitl:
            if surface != "web" or not (
                (status == 404 and rule.startswith(prefix + "/form/human_input/"))
                or (status == 403 and rule == prefix + "/human-input-forms/files")
            ):
                return response
        elif status != 404 and not (surface == "web" and status == 400 and is_app_identity):
            return response

        # Non-HITL 404s still need inspection outside the identity allowlist:
        # typed app_not_found errors can originate from invocation/resource routes.
        payload = response.get_json(silent=True)
        if not isinstance(payload, dict):
            return response
        # Preserve HITL's dedicated expiry/token UI and do not expose an App IP
        # or policy-specific marker through these capability endpoints.
        if is_hitl:
            if (
                surface == "web"
                and rule.startswith(prefix + "/form/human_input/")
                and response.status_code == 404
                and payload.get("code") == "not_found"
            ):
                return _canonical_json(response, {"code": "not_found", "message": "Form not found", "status": 404})
            if (
                surface == "web"
                and rule == prefix + "/human-input-forms/files"
                and response.status_code == 403
                and payload.get("code") == "invalid_upload_token"
            ):
                return _canonical_json(
                    response,
                    {"code": "invalid_upload_token", "message": "Upload token is invalid or expired.", "status": 403},
                )
            return response
        if (
            surface == "web"
            and is_app_identity
            and response.status_code == 400
            and payload.get("code") in _UNAVAILABLE_APP_CODES
        ):
            # A known unavailable/unpublished App is the same public state as a
            # missing one. Never apply this to arbitrary 400s or dependency503s.
            response.status_code = 404
        if response.status_code != 404:
            return response
        if payload.get("code") != "app_not_found" and not is_app_identity:
            return response

        if surface == "web":
            # Do not preserve exception-specific data that would disclose why
            # an App is unavailable (or whether it exists) to an unauthenticated
            # visitor. Console's authenticated management errors are unchanged.
            payload = {"code": "app_not_found", "message": "App not found.", "status": 404}

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

        if surface == "web":
            return _canonical_json(response, payload)
        response.set_data(current_app.json.dumps(payload))
        return response
