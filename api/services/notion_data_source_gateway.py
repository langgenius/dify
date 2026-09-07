"""Notion adapter for the OAuth data-source application port."""

import urllib.parse
from collections.abc import Mapping
from typing import Any, Literal, TypedDict, override

import httpx
from pydantic import TypeAdapter, ValidationError

from core.helper.ssrf_proxy import MaxRetriesExceededError, SSRFProxy
from core.tools.errors import ToolSSRFError
from services.data_source_oauth_service import DataSourceOAuthError, DataSourceProviderGateway
from services.entities.data_source_oauth_entities import DataSourceOAuthAuthorization


class _NotionPageSummary(TypedDict):
    page_id: str
    page_name: str
    page_icon: dict[str, str] | None
    parent_id: str
    type: Literal["page", "database"]


class _NotionSourceInfo(TypedDict):
    workspace_name: str | None
    workspace_icon: str | None
    workspace_id: str | None
    pages: list[_NotionPageSummary]
    total: int


_NOTION_SOURCE_INFO_ADAPTER = TypeAdapter(_NotionSourceInfo)
_NOTION_PAGE_SUMMARY_ADAPTER = TypeAdapter(_NotionPageSummary)


class NotionDataSourceGateway(DataSourceProviderGateway):
    _AUTH_URL = "https://api.notion.com/v1/oauth/authorize"
    _TOKEN_URL = "https://api.notion.com/v1/oauth/token"
    _NOTION_PAGE_SEARCH = "https://api.notion.com/v1/search"
    _NOTION_BLOCK_SEARCH = "https://api.notion.com/v1/blocks"
    _NOTION_BOT_USER = "https://api.notion.com/v1/users/me"

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        http_client: httpx.Client | SSRFProxy,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._http_client = http_client

    @override
    def get_authorization_url(self) -> str:
        params = {
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": self._redirect_uri,
            "owner": "user",
        }
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    @override
    def authorize(self, code: str) -> DataSourceOAuthAuthorization:
        response_json = self._post_json(
            self._TOKEN_URL,
            data={"code": code, "grant_type": "authorization_code", "redirect_uri": self._redirect_uri},
            auth=(self._client_id, self._client_secret),
            headers={"Accept": "application/json"},
        )
        access_token = response_json.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise DataSourceOAuthError("Notion OAuth response did not include an access token")

        try:
            source_info = self._build_source_info(
                workspace_name=self._optional_string(response_json.get("workspace_name")),
                workspace_icon=self._optional_string(response_json.get("workspace_icon")),
                workspace_id=self._optional_string(response_json.get("workspace_id")),
                pages=self.get_authorized_pages(access_token),
            )
        except (KeyError, TypeError, ValidationError) as exc:
            raise DataSourceOAuthError("Notion OAuth response was invalid") from exc
        return DataSourceOAuthAuthorization(access_token=access_token, source_info=source_info)

    @override
    def authorize_internal(self, access_token: str, workspace_id: str) -> DataSourceOAuthAuthorization:
        try:
            source_info = self._build_source_info(
                workspace_name=self.notion_workspace_name(access_token),
                workspace_icon=None,
                workspace_id=workspace_id,
                pages=self.get_authorized_pages(access_token),
            )
        except (KeyError, TypeError, ValidationError) as exc:
            raise DataSourceOAuthError("Notion integration response was invalid") from exc
        return DataSourceOAuthAuthorization(access_token=access_token, source_info=source_info)

    @override
    def refresh(self, access_token: str, source_info: Mapping[str, object]) -> Mapping[str, object]:
        try:
            return self._build_source_info(
                workspace_name=self._optional_string(source_info.get("workspace_name")),
                workspace_icon=self._optional_string(source_info.get("workspace_icon")),
                workspace_id=self._optional_string(source_info.get("workspace_id")),
                pages=self.get_authorized_pages(access_token),
            )
        except (KeyError, TypeError, ValidationError) as exc:
            raise DataSourceOAuthError("Notion integration response was invalid") from exc

    def get_authorized_pages(self, access_token: str) -> list[_NotionPageSummary]:
        pages: list[_NotionPageSummary] = []
        page_results = self.notion_page_search(access_token)
        database_results = self.notion_database_search(access_token)
        for page_result in page_results:
            page_id = page_result["id"]
            page_name = "Untitled"
            for prop in page_result["properties"].values():
                if title_list := prop.get("title"):
                    if title_list and "plain_text" in title_list[0]:
                        page_name = title_list[0]["plain_text"]
            page_icon = page_result["icon"]
            if page_icon:
                icon_type = page_icon["type"]
                if icon_type in {"external", "file"}:
                    url = page_icon[icon_type]["url"]
                    icon = {"type": "url", "url": url if url.startswith("http") else f"https://www.notion.so{url}"}
                else:
                    icon = {"type": "emoji", "emoji": page_icon[icon_type]}
            else:
                icon = None
            parent = page_result["parent"]
            parent_type = parent["type"]
            if parent_type == "block_id":
                parent_id = self.notion_block_parent_page_id(access_token, parent[parent_type])
            elif parent_type == "workspace":
                parent_id = "root"
            else:
                parent_id = parent[parent_type]
            pages.append(
                _NOTION_PAGE_SUMMARY_ADAPTER.validate_python(
                    {
                        "page_id": page_id,
                        "page_name": page_name,
                        "page_icon": icon,
                        "parent_id": parent_id,
                        "type": "page",
                    }
                )
            )

        for database_result in database_results:
            page_id = database_result["id"]
            page_name = database_result["title"][0]["plain_text"] if database_result["title"] else "Untitled"
            page_icon = database_result["icon"]
            if page_icon:
                icon_type = page_icon["type"]
                if icon_type in {"external", "file"}:
                    url = page_icon[icon_type]["url"]
                    icon = {"type": "url", "url": url if url.startswith("http") else f"https://www.notion.so{url}"}
                else:
                    icon = {"type": icon_type, icon_type: page_icon[icon_type]}
            else:
                icon = None
            parent = database_result["parent"]
            parent_type = parent["type"]
            if parent_type == "block_id":
                parent_id = self.notion_block_parent_page_id(access_token, parent[parent_type])
            elif parent_type == "workspace":
                parent_id = "root"
            else:
                parent_id = parent[parent_type]
            pages.append(
                _NOTION_PAGE_SUMMARY_ADAPTER.validate_python(
                    {
                        "page_id": page_id,
                        "page_name": page_name,
                        "page_icon": icon,
                        "parent_id": parent_id,
                        "type": "database",
                    }
                )
            )
        return pages

    def notion_page_search(self, access_token: str) -> list[dict[str, Any]]:
        return self._search(access_token, object_type="page")

    def notion_database_search(self, access_token: str) -> list[dict[str, Any]]:
        return self._search(access_token, object_type="database")

    def _search(self, access_token: str, *, object_type: str) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        next_cursor: str | None = None
        has_more = True
        while has_more:
            data: dict[str, Any] = {
                "filter": {"value": object_type, "property": "object"},
                **({"start_cursor": next_cursor} if next_cursor else {}),
            }
            response_json = self._post_json(
                self._NOTION_PAGE_SEARCH,
                json=data,
                headers=self._notion_headers(access_token, content_type=True),
            )
            raw_results = response_json.get("results", [])
            if not isinstance(raw_results, list):
                raise DataSourceOAuthError("Notion search response was invalid")
            results.extend(raw_results)
            has_more = response_json.get("has_more", False) is True
            raw_cursor = response_json.get("next_cursor")
            if has_more and (not isinstance(raw_cursor, str) or not raw_cursor):
                raise DataSourceOAuthError("Notion search response did not include a valid next_cursor")
            next_cursor = raw_cursor if isinstance(raw_cursor, str) else None
        return results

    def notion_block_parent_page_id(self, access_token: str, block_id: str) -> str:
        response_json = self._get_json(
            f"{self._NOTION_BLOCK_SEARCH}/{block_id}",
            headers=self._notion_headers(access_token),
        )
        parent = response_json.get("parent")
        if not isinstance(parent, dict):
            raise DataSourceOAuthError("Notion block response was invalid")
        parent_type = parent.get("type")
        if not isinstance(parent_type, str) or parent_type not in parent:
            raise DataSourceOAuthError("Notion block parent was invalid")
        parent_id = parent[parent_type]
        if not isinstance(parent_id, str):
            raise DataSourceOAuthError("Notion block parent identifier was invalid")
        if parent_type == "block_id":
            return self.notion_block_parent_page_id(access_token, parent_id)
        return parent_id

    def notion_workspace_name(self, access_token: str) -> str:
        response_json = self._get_json(self._NOTION_BOT_USER, headers=self._notion_headers(access_token))
        if response_json.get("object") == "user":
            user_type = response_json.get("type")
            user_info = response_json.get(user_type) if isinstance(user_type, str) else None
            if isinstance(user_info, dict) and isinstance(user_info.get("workspace_name"), str):
                return user_info["workspace_name"]
        return "workspace"

    def _post_json(self, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self._http_client.post(url, **kwargs)
        except (httpx.HTTPError, MaxRetriesExceededError, ToolSSRFError) as exc:
            raise DataSourceOAuthError("Notion request failed") from exc
        return self._response_json(response)

    def _get_json(self, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self._http_client.get(url, **kwargs)
        except (httpx.HTTPError, MaxRetriesExceededError, ToolSSRFError) as exc:
            raise DataSourceOAuthError("Notion request failed") from exc
        return self._response_json(response)

    @staticmethod
    def _response_json(response: httpx.Response) -> dict[str, Any]:
        try:
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise DataSourceOAuthError("Notion returned an unsuccessful response") from exc
        if not isinstance(payload, dict):
            raise DataSourceOAuthError("Notion response was invalid")
        return payload

    @staticmethod
    def _notion_headers(access_token: str, *, content_type: bool = False) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
        }
        if content_type:
            headers["Content-Type"] = "application/json"
        return headers

    @staticmethod
    def _optional_string(value: object) -> str | None:
        return value if isinstance(value, str) else None

    @staticmethod
    def _build_source_info(
        *,
        workspace_name: str | None,
        workspace_icon: str | None,
        workspace_id: str | None,
        pages: list[_NotionPageSummary],
    ) -> _NotionSourceInfo:
        return _NOTION_SOURCE_INFO_ADAPTER.validate_python(
            {
                "workspace_name": workspace_name,
                "workspace_icon": workspace_icon,
                "workspace_id": workspace_id,
                "pages": pages,
                "total": len(pages),
            }
        )
