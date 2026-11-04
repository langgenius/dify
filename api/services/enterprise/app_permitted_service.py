from __future__ import annotations

import logging

from services.enterprise.enterprise_service import EnterpriseService
from services.entities.app_entities import PermittedAppsPage
from services.errors.app import PermittedAppsUnavailableError
from services.errors.enterprise import EnterpriseAPIError

logger = logging.getLogger(__name__)


def list_permitted_apps(
    *,
    page: int,
    limit: int,
    mode: str | None = None,
    name: str | None = None,
) -> PermittedAppsPage:
    try:
        body = EnterpriseService.WebAppAuth.list_externally_accessible_apps(
            page=page, limit=limit, mode=mode, name=name
        )
    except EnterpriseAPIError as exc:
        logger.warning(
            "permitted_apps EE call failed: status=%s message=%s",
            getattr(exc, "status_code", None),
            str(exc),
        )
        raise PermittedAppsUnavailableError("permitted_apps_unavailable") from exc

    return PermittedAppsPage(
        app_ids=[row["appId"] for row in body.get("data", [])],
        total=int(body.get("total", 0)),
        has_more=bool(body.get("hasMore", False)),
    )
