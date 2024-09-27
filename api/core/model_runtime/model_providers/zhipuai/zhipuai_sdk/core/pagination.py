# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Any, Generic, Optional, TypeVar, cast, runtime_checkable

from typing_extensions import Protocol, override

from ._http_client import BasePage, BaseSyncPage, PageInfo

__all__ = ["SyncPage", "SyncCursorPage"]

_T = TypeVar("_T")


@runtime_checkable
class CursorPageItem(Protocol):
    id: Optional[str]


class SyncPage(BaseSyncPage[_T], BasePage[_T], Generic[_T]):
    """Note: no pagination actually occurs yet, this is for forwards-compatibility."""

    data: list[_T]
    object: str

    @override
    def _get_page_items(self) -> list[_T]:
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
    data: list[_T]

    @override
    def _get_page_items(self) -> list[_T]:
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
