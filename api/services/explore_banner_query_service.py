"""Application service for listing Explore banners.

ExploreBanner is the legacy contract name shared by the API, feature flag, and database model.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Any, NamedTuple, Protocol

_DEFAULT_LANGUAGE = "en-US"


class ExploreBannerRecord(NamedTuple):
    id: str
    content: dict[str, Any]
    link: str
    sort: int
    status: str
    created_at: datetime


class ExploreBannerQuery(Protocol):
    def list_enabled(self, language: str) -> Sequence[ExploreBannerRecord]: ...


class ExploreBannerQueryService:
    def __init__(
        self,
        *,
        banners: ExploreBannerQuery,
        enabled: bool,
    ) -> None:
        self._banners = banners
        self._enabled = enabled

    def list_for_language(self, language: str) -> tuple[ExploreBannerRecord, ...]:
        if not self._enabled:
            return ()

        banners = tuple(self._banners.list_enabled(language))
        if banners or language == _DEFAULT_LANGUAGE:
            return banners

        return tuple(self._banners.list_enabled(_DEFAULT_LANGUAGE))
