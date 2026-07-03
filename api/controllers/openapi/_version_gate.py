"""Version gate: reject outdated difyctl clients on /openapi/v1 with HTTP 426.

difyctl and the ``/openapi/v1`` surface ship in lockstep. A breaking path change
(resource-oriented paths) means an outdated difyctl calls removed paths and would
otherwise get a bare 404. This gate reads the difyctl version from the User-Agent
and returns ``426 Upgrade Required`` with an upgrade hint when the client is older
than the minimum this server supports.

Design record: dify-todo/inprogress/difyctl/openapi/version.md
"""

from __future__ import annotations

import re
from typing import Final

from flask import Blueprint, Response, request
from packaging.version import InvalidVersion, Version

from controllers.openapi._errors import ErrorBody, OpenApiErrorCode

# Oldest difyctl this server serves. Bumped in lockstep with breaking
# /openapi/v1 changes (paired with difyctl's own version + its MIN_DIFY_VERSION).
MIN_DIFYCTL_VERSION: Final = "0.2.0"

_UPGRADE_HINT: Final = "Upgrade difyctl: https://docs.dify.ai/en/cli/install"

# difyctl sends `User-Agent: difyctl/<semver> (<os>; <arch>; <channel>)`.
_DIFYCTL_UA_RE = re.compile(r"^difyctl/(\d+\.\d+\.\d+(?:-[\w.]+)?)")

_PREFIX: Final = "/openapi/v1/"

# Paths a too-old client must still reach to discover that it is outdated.
_ALLOWLIST: Final = frozenset({"/openapi/v1/_version", "/openapi/v1/_health"})


def _upgrade_required_response(client_version: str) -> Response:
    body = ErrorBody(
        code=OpenApiErrorCode.UPGRADE_REQUIRED,
        message=f"difyctl {client_version} is no longer supported; upgrade to >= {MIN_DIFYCTL_VERSION}.",
        status=426,
        hint=_UPGRADE_HINT,
    )
    return Response(body.model_dump_json(exclude_none=True), status=426, mimetype="application/json")


def attach_version_gate(bp: Blueprint) -> None:
    """Reject difyctl clients older than ``MIN_DIFYCTL_VERSION`` with 426.

    Registered app-wide (``before_app_request``) rather than blueprint-scoped so it
    also fires for requests to *removed* paths — those no longer match an openapi
    route and would 404 before a blueprint-scoped ``before_request`` ever runs. The
    prefix guard scopes it back to ``/openapi/v1``. Fails open for non-difyctl or
    unparseable User-Agents (only a confidently-too-old difyctl is blocked).
    """

    @bp.before_app_request
    def _enforce_min_client_version() -> Response | None:  # pyright: ignore[reportUnusedFunction]
        if not request.path.startswith(_PREFIX):
            return None
        if request.path in _ALLOWLIST:
            return None
        match = _DIFYCTL_UA_RE.match(request.headers.get("User-Agent", ""))
        if match is None:
            return None
        try:
            client_version = Version(match.group(1))
        except InvalidVersion:
            return None
        if client_version < Version(MIN_DIFYCTL_VERSION):
            return _upgrade_required_response(match.group(1))
        return None
