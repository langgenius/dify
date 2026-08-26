"""Application service for compliance document downloads."""

from collections.abc import Callable
from typing import Protocol, TypedDict

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.errors.billing import ComplianceRateLimitExceededError


class ComplianceDownloadLink(TypedDict):
    url: str


class ComplianceDownloadRateLimiter(Protocol):
    def is_rate_limited(self, key: str, /) -> bool: ...

    def increment_rate_limit(self, key: str, /) -> None: ...


class ComplianceDownloadService:
    def __init__(
        self,
        *,
        fetch_link: Callable[[str, str, str, str, str], ComplianceDownloadLink],
        rate_limiter: ComplianceDownloadRateLimiter,
    ) -> None:
        self._fetch_link = fetch_link
        self._rate_limiter = rate_limiter

    def get_link(
        self,
        *,
        request_context: RequestContext,
        document_name: str,
        ip_address: str,
        device_info: str,
    ) -> ComplianceDownloadLink:
        workspace_id = request_context.active_workspace_id
        if workspace_id is None:
            raise ActiveWorkspaceRequiredError

        account_id = request_context.account_id
        limiter_key = f"{account_id}:{workspace_id}"
        if self._rate_limiter.is_rate_limited(limiter_key):
            raise ComplianceRateLimitExceededError

        link = self._fetch_link(document_name, account_id, workspace_id, ip_address, device_info)
        self._rate_limiter.increment_rate_limit(limiter_key)
        return link
