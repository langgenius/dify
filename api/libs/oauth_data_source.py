import datetime
import json
import logging
import urllib.parse
from collections import deque
from typing import Any, Optional

import httpx
import requests
from flask_login import current_user
from flask_restful import reqparse

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.source import DataSourceOauthBinding

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


class OAuthDataSource:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def get_authorization_url(self):
        raise NotImplementedError()

    def get_access_token(self, code: str):
        raise NotImplementedError()


class NotionOAuth(OAuthDataSource):
    _AUTH_URL = "https://api.notion.com/v1/oauth/authorize"
    _TOKEN_URL = "https://api.notion.com/v1/oauth/token"
    _NOTION_PAGE_SEARCH = "https://api.notion.com/v1/search"
    _NOTION_BLOCK_SEARCH = "https://api.notion.com/v1/blocks"
    _NOTION_BOT_USER = "https://api.notion.com/v1/users/me"

    def get_authorization_url(self):
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "owner": "user",
        }
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str):
        data = {"code": code, "grant_type": "authorization_code", "redirect_uri": self.redirect_uri}
        headers = {"Accept": "application/json"}
        auth = (self.client_id, self.client_secret)
        response = requests.post(self._TOKEN_URL, data=data, auth=auth, headers=headers)

        response_json = response.json()
        access_token = response_json.get("access_token")
        if not access_token:
            raise ValueError(f"Error in Notion OAuth: {response_json}")
        workspace_name = response_json.get("workspace_name")
        workspace_icon = response_json.get("workspace_icon")
        workspace_id = response_json.get("workspace_id")
        # get all authorized pages
        pages = self.get_authorized_pages(access_token)
        source_info = {
            "workspace_name": workspace_name,
            "workspace_icon": workspace_icon,
            "workspace_id": workspace_id,
            "pages": pages,
            "total": len(pages),
        }
        # save data source binding
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == "notion",
                DataSourceOauthBinding.access_token == access_token,
            )
        ).first()
        if data_source_binding:
            data_source_binding.source_info = source_info
            data_source_binding.disabled = False
            data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        else:
            new_data_source_binding = DataSourceOauthBinding(
                tenant_id=current_user.current_tenant_id,
                access_token=access_token,
                source_info=source_info,
                provider="notion",
            )
            db.session.add(new_data_source_binding)
            db.session.commit()

    def save_internal_access_token(self, access_token: str):
        workspace_name = self.notion_workspace_name(access_token)
        workspace_icon = None
        workspace_id = current_user.current_tenant_id
        # get all authorized pages
        pages = self.get_authorized_pages(access_token)
        source_info = {
            "workspace_name": workspace_name,
            "workspace_icon": workspace_icon,
            "workspace_id": workspace_id,
            "pages": pages,
            "total": len(pages),
        }
        # save data source binding
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == "notion",
                DataSourceOauthBinding.access_token == access_token,
            )
        ).first()
        if data_source_binding:
            data_source_binding.source_info = source_info
            data_source_binding.disabled = False
            data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        else:
            new_data_source_binding = DataSourceOauthBinding(
                tenant_id=current_user.current_tenant_id,
                access_token=access_token,
                source_info=source_info,
                provider="notion",
            )
            db.session.add(new_data_source_binding)
            db.session.commit()

    def sync_data_source(self, binding_id: str):
        # save data source binding
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == "notion",
                DataSourceOauthBinding.id == binding_id,
                DataSourceOauthBinding.disabled == False,
            )
        ).first()
        if data_source_binding:
            # get all authorized pages
            pages = self.get_authorized_pages(data_source_binding.access_token)
            source_info = data_source_binding.source_info
            new_source_info = {
                "workspace_name": source_info["workspace_name"],
                "workspace_icon": source_info["workspace_icon"],
                "workspace_id": source_info["workspace_id"],
                "pages": pages,
                "total": len(pages),
            }
            data_source_binding.source_info = new_source_info
            data_source_binding.disabled = False
            data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        else:
            raise ValueError("Data source binding not found")

    def get_authorized_pages(self, access_token: str):
        pages = []
        page_results = self.notion_page_search(access_token)
        database_results = self.notion_database_search(access_token)
        # get page detail
        for page_result in page_results:
            page_id = page_result["id"]
            page_name = "Untitled"
            for key in page_result["properties"]:
                if "title" in page_result["properties"][key] and page_result["properties"][key]["title"]:
                    title_list = page_result["properties"][key]["title"]
                    if len(title_list) > 0 and "plain_text" in title_list[0]:
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
            page = {
                "page_id": page_id,
                "page_name": page_name,
                "page_icon": icon,
                "parent_id": parent_id,
                "type": "page",
            }
            pages.append(page)
            # get database detail
        for database_result in database_results:
            page_id = database_result["id"]
            if len(database_result["title"]) > 0:
                page_name = database_result["title"][0]["plain_text"]
            else:
                page_name = "Untitled"
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
            page = {
                "page_id": page_id,
                "page_name": page_name,
                "page_icon": icon,
                "parent_id": parent_id,
                "type": "database",
            }
            pages.append(page)
        return pages

    def notion_page_search(self, access_token: str):
        data = {"filter": {"value": "page", "property": "object"}}
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
        }
        response = requests.post(url=self._NOTION_PAGE_SEARCH, json=data, headers=headers)
        response_json = response.json()
        results = response_json.get("results", [])
        return results

    def notion_block_parent_page_id(self, access_token: str, block_id: str):
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
        }
        response = requests.get(url=f"{self._NOTION_BLOCK_SEARCH}/{block_id}", headers=headers)
        response_json = response.json()
        parent = response_json["parent"]
        parent_type = parent["type"]
        if parent_type == "block_id":
            return self.notion_block_parent_page_id(access_token, parent[parent_type])
        return parent[parent_type]

    def notion_workspace_name(self, access_token: str):
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
        }
        response = requests.get(url=self._NOTION_BOT_USER, headers=headers)
        response_json = response.json()
        if "object" in response_json and response_json["object"] == "user":
            user_type = response_json["type"]
            user_info = response_json[user_type]
            if "workspace_name" in user_info:
                return user_info["workspace_name"]
        return "workspace"

    def notion_database_search(self, access_token: str):
        data = {"filter": {"value": "database", "property": "object"}}
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
        }
        response = requests.post(url=self._NOTION_PAGE_SEARCH, json=data, headers=headers)
        response_json = response.json()
        results = response_json.get("results", [])
        return results


class FeishuWikiOAuth:
    def save_feishu_wiki_data_source(self, app_id: str, app_secret: str):
        workspace_name = app_id
        workspace_icon = None
        workspace_id = current_user.current_tenant_id

        feishu_wiki = FeishuWiki(app_id, app_secret)

        spaces = feishu_wiki.get_all_feishu_wiki_spaces()
        pages = []
        for space in spaces:
            space_id = space["space_id"]
            all_nodes = feishu_wiki.get_all_feishu_wiki_space_nodes(space_id)
            nodes = transform_nodes(all_nodes)
            pages.extend(nodes)

        source_info = {
            "workspace_name": workspace_name,
            "workspace_icon": workspace_icon,
            "workspace_id": workspace_id,
            "pages": pages,
            "total": len(pages),
        }

        app_info = {"app_id": app_id, "app_secret": app_secret}
        access_token = json.dumps(app_info)

        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == "feishuwiki",
                DataSourceOauthBinding.access_token == access_token,
            )
        ).first()
        if data_source_binding:
            data_source_binding.source_info = source_info
            data_source_binding.disabled = False
            data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        else:
            new_data_source_binding = DataSourceOauthBinding(
                tenant_id=current_user.current_tenant_id,
                access_token=access_token,
                source_info=source_info,
                provider="feishuwiki",
            )
            db.session.add(new_data_source_binding)
            db.session.commit()

    def sync_data_source(self, binding_id: str):
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == "feishuwiki",
                DataSourceOauthBinding.id == binding_id,
                DataSourceOauthBinding.disabled == False,
            )
        ).first()
        if data_source_binding:
            access_token = data_source_binding.access_token
            app_info = json.loads(access_token)
            app_id = app_info["app_id"]
            app_secret = app_info["app_secret"]
            feishu_wiki = FeishuWiki(app_id, app_secret)

            workspace_name = app_id
            workspace_icon = None
            workspace_id = current_user.current_tenant_id

            spaces = feishu_wiki.get_all_feishu_wiki_spaces()
            pages = []

            for space in spaces:
                space_id = space["space_id"]
                all_nodes = feishu_wiki.get_all_feishu_wiki_space_nodes(space_id)
                nodes = transform_nodes(all_nodes)
                pages.extend(nodes)

            source_info = {
                "workspace_name": workspace_name,
                "workspace_icon": workspace_icon,
                "workspace_id": workspace_id,
                "pages": pages,
                "total": len(pages),
            }

            data_source_binding.source_info = source_info
            data_source_binding.disabled = False
            data_source_binding.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        else:
            raise ValueError("Data source binding not found")

    def validate_certificate(self):
        parser = reqparse.RequestParser()
        parser.add_argument("app_id", type=str, required=True, location="json")
        parser.add_argument("app_secret", type=str, required=True, location="json")
        args = parser.parse_args()

        app_id = args["app_id"]
        app_secret = args["app_secret"]

        if not app_id or not app_secret:
            raise ValueError("app_id and app_secret is required")
        try:
            assert FeishuWiki(app_id, app_secret).tenant_access_token is not None
            FeishuWikiOAuth().save_feishu_wiki_data_source(app_id, app_secret)
        except Exception as e:
            raise Exception(str(e))


def transform_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    level = []
    for node in nodes:
        obj_type = node.get("obj_type")
        node_type = node.get("node_type")
        if obj_type == "docx" and node_type == "origin":
            level.append(
                {
                    "page_id": node.get("node_token"),
                    "page_name": node.get("title") or "未命名文档",
                    "parent_id": node.get("parent_node_token") or "root",
                    "obj_token": node.get("obj_token"),
                    "obj_type": node.get("obj_type"),
                    "space_id": node.get("space_id"),
                }
            )
    return level


class FeishuWiki:
    API_BASE_URL = "https://open.feishu.cn/open-apis"

    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret

    def _send_request(
        self,
        url: str,
        method: str = "post",
        require_token: bool = True,
        payload: Optional[dict] = None,
        params: Optional[dict] = None,
    ):
        headers = {
            "Content-Type": "application/json",
            "user-agent": "Dify",
        }
        if require_token:
            headers["Authorization"] = f"Bearer {self.tenant_access_token}"
        res = httpx.request(method=method, url=url, headers=headers, json=payload, params=params, timeout=60).json()
        if res.get("code") != 0:
            raise Exception(res)
        return res

    @property
    def tenant_access_token(self):
        redis_key = f"datasource:{self.app_id}:tenant_access_token"
        token = redis_client.get(redis_key)
        if token:
            return token.decode()
        resp = self.fetch_tenant_access_token(self.app_id, self.app_secret)
        redis_client.setex(redis_key, resp["expire"], resp["tenant_access_token"])
        return resp["tenant_access_token"]

    def fetch_tenant_access_token(self, app_id: str, app_secret: str) -> dict:
        url = f"{self.API_BASE_URL}/auth/v3/tenant_access_token/internal"
        payload = {"app_id": app_id, "app_secret": app_secret}
        return self._send_request(url, require_token=False, payload=payload)

    def get_all_feishu_wiki_spaces(self, page_size: int = 50):
        url = f"{self.API_BASE_URL}/wiki/v2/spaces"
        all_spaces = []
        page_token = ""
        while True:
            params = {"page_size": page_size, "page_token": page_token, "lang": "en"}
            res = self._send_request(url, method="GET", params=params)
            all_spaces.extend(res.get("data", {}).get("items", []))
            page_token = res.get("page_token", "")
            if not page_token:
                break
        logging.info(f"all_spaces: {all_spaces}")
        return all_spaces

    def get_all_feishu_wiki_space_nodes(
        self, space_id: str, parent_node_token: str = "", page_size: int = 50
    ) -> list[dict[str, Any]]:
        url = f"{self.API_BASE_URL}/wiki/v2/spaces/{space_id}/nodes"
        all_nodes = []
        queue = deque([parent_node_token])
        while queue:
            current_parent_token = queue.popleft()
            page_token = ""
            while True:
                params = {
                    "page_token": page_token,
                    "page_size": page_size,
                    "parent_node_token": current_parent_token,
                }
                res = self._send_request(url, method="GET", params=params)
                data = res.get("data", {})
                items = data.get("items", [])
                all_nodes.extend(items)

                has_more = data.get("has_more", False)
                page_token = data.get("page_token", "")
                if not has_more or not page_token:
                    break

            for item in items:
                if item.get("has_child"):
                    queue.append(item.get("node_token"))

        return all_nodes

    def get_feishu_wiki_node_last_edited_time(self, token: str, obj_type: str) -> str:
        url = f"{self.API_BASE_URL}/wiki/v2/spaces/get_node"
        params = {
            "token": token,
            "obj_type": obj_type,
        }
        res = self._send_request(url, method="GET", params=params)
        data = res.get("data", [])
        node = data.get("node", {})
        if node:
            return node.get("last_edited_time", "")
        return ""

    def get_document_markdown_content(self, document_id: str):
        params = {
            "document_id": document_id,
        }
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/document/get_document_content"
        res = self._send_request(url, method="GET", params=params)
        content = res.get("data", {}).get("content")
        return content
