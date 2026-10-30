"""Deployment discovery adapters for Account consumer queries."""

import httpx

from services.enterprise.enterprise_service import EnterpriseService
from services.errors.enterprise import EnterpriseServiceError
from services.webapp_access_query_service import WebAppAccessUnavailableError


class SharedConsumerAppDiscovery:
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    def __call__(self) -> tuple[str, ...]:
        if not self._enabled:
            return ()
        app_ids: list[str] = []
        seen: set[str] = set()
        page = 1
        while True:
            try:
                result = EnterpriseService.WebAppAuth.list_externally_accessible_apps(page=page, limit=100)
                rows = result["data"]
                ids = [row["appId"] for row in rows]
                has_more = result["hasMore"]
                if not isinstance(has_more, bool) or any(not isinstance(id_, str) for id_ in ids):
                    raise ValueError("Malformed App discovery response")
                if has_more and not set(ids).difference(seen):
                    raise ValueError("App discovery did not advance")
            except (EnterpriseServiceError, httpx.RequestError, KeyError, TypeError, ValueError) as error:
                raise WebAppAccessUnavailableError from error
            app_ids.extend(ids)
            seen.update(ids)
            if not has_more:
                return tuple(dict.fromkeys(app_ids))
            page += 1
