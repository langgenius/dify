"""Single-source visibility filter for the /openapi/v1/* surface.

Keep every openapi-surface app query routed through ``_apply_openapi_gate``;
retiring or replacing the gate then becomes a one-line change here.

The Service API (/v1/* app-key surface) does NOT use this helper — that
surface has its own per-request guard (``service_api_disabled``) wired
into the legacy ``validate_app_token`` decorator.
"""

from __future__ import annotations

from typing import Any

from models.model import App


def apply_openapi_gate(query: Any) -> Any:
    """Filter a SQLAlchemy Select/Query to apps visible on /openapi/v1/*.

    Works with both legacy ``Query.filter`` and 2.0-style ``Select.filter``
    (alias of ``.where``).
    """
    return query.filter(App.enable_api.is_(True))


def is_openapi_visible(app: App) -> bool:
    """Per-row counterpart for code paths that fetch an App by primary key
    (``session.get`` / ``session.scalar``) and need the same visibility check
    the query gate would have applied.
    """
    return bool(app.enable_api)
