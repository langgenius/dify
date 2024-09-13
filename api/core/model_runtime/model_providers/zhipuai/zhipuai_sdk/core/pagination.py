# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Any, List, Generic, TypeVar, Optional, cast
from typing_extensions import Protocol, override, runtime_checkable

from ._http_client import BasePage, PageInfo, BaseSyncPage

__all__ = ["SyncPage", "SyncCursorPage"]

_T = TypeVar("_T")


@runtime_checkable
class CursorPageItem(Protocol):
    id: Optional[str]


class SyncPage(BaseSyncPage[_T], BasePage[_T], Generic[_T]):
    """Note: no pagination actually occurs yet, this is for forwards-compatibility."""

    data: List[_T]
    object: str

    @override
    def _get_page_items(self) -> List[_T]:
        data = self.data
        if not data:
            return []
        return data

    @override
    def next_page_info(self) -> None:
        """
        This page represents a response that isn't actually paginated at the API level
        so there will never be a next page.
        """
        return None


class SyncCursorPage(BaseSyncPage[_T], BasePage[_T], Generic[_T]):
    data: List[_T]

    @override
    def _get_page_items(self) -> List[_T]:
        data = self.data
        if not data:
            return []
        return data

    @override
    def next_page_info(self) -> Optional[PageInfo]:
        data = self.data
        if not data:
            return None

        item = cast(Any, data[-1])
        if not isinstance(item, CursorPageItem) or item.id is None:
            # TODO emit warning log
            return None

        return PageInfo(params={"after": item.id})
