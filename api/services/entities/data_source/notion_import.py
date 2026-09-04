"""Framework-neutral values used by Notion import use cases."""

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class NotionPageIcon:
    type: str | None = None
    url: str | None = None
    emoji: str | None = None


@dataclass(frozen=True, slots=True)
class AuthorizedNotionPage:
    page_id: str
    page_name: str
    page_icon: NotionPageIcon | None
    parent_id: str | None
    page_type: str


@dataclass(frozen=True, slots=True)
class NotionImportPage:
    page_id: str
    page_name: str
    page_icon: NotionPageIcon | None
    parent_id: str | None
    page_type: str
    is_bound: bool


@dataclass(frozen=True, slots=True)
class NotionWorkspace:
    workspace_id: str | None
    workspace_name: str | None
    workspace_icon: str | None
    pages: tuple[AuthorizedNotionPage, ...]


@dataclass(frozen=True, slots=True)
class NotionImportWorkspace:
    workspace_id: str | None
    workspace_name: str | None
    workspace_icon: str | None
    pages: tuple[NotionImportPage, ...]


@dataclass(frozen=True, slots=True)
class NotionImportResult:
    workspaces: tuple[NotionImportWorkspace, ...]


def notion_page_icon(value: Mapping[str, object] | None) -> NotionPageIcon | None:
    """Map a plugin icon payload without leaking the plugin entity type."""

    if value is None:
        return None
    icon_type = value.get("type")
    url = value.get("url")
    emoji = value.get("emoji")
    return NotionPageIcon(
        type=icon_type if isinstance(icon_type, str) else None,
        url=url if isinstance(url, str) else None,
        emoji=emoji if isinstance(emoji, str) else None,
    )
