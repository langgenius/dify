import urllib.parse

import requests
from flask_login import current_user

from extensions.ext_database import db
from models.source import DataSourceOauthBinding


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
    _AUTH_URL = 'https://api.notion.com/v1/oauth/authorize'
    _TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
    _NOTION_PAGE_SEARCH = "https://api.notion.com/v1/search"
    _NOTION_BLOCK_SEARCH = "https://api.notion.com/v1/blocks"
    _NOTION_BOT_USER = "https://api.notion.com/v1/users/me"

    def get_authorization_url(self):
        params = {
            'client_id': self.client_id,
            'response_type': 'code',
            'redirect_uri': self.redirect_uri,
            'owner': 'user'
        }
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str):
        data = {
            'code': code,
            'grant_type': 'authorization_code',
            'redirect_uri': self.redirect_uri
        }
        headers = {'Accept': 'application/json'}
        auth = (self.client_id, self.client_secret)
        response = requests.post(self._TOKEN_URL, data=data, auth=auth, headers=headers)

        response_json = response.json()
        access_token = response_json.get('access_token')
        if not access_token:
            raise ValueError(f"Error in Notion OAuth: {response_json}")
        workspace_name = response_json.get('workspace_name')
        workspace_icon = response_json.get('workspace_icon')
        workspace_id = response_json.get('workspace_id')
        # get all authorized pages
        pages = self.get_authorized_pages(access_token)
        source_info = {
            'workspace_name': workspace_name,
            'workspace_icon': workspace_icon,
            'workspace_id': workspace_id,
            'pages': pages,
            'total': len(pages)
        }
        # save data source binding
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == 'notion',
                DataSourceOauthBinding.access_token == access_token
            )
        ).first()
        if data_source_binding:
            data_source_binding.source_info = source_info
            data_source_binding.disabled = False
            db.session.commit()
        else:
            new_data_source_binding = DataSourceOauthBinding(
                tenant_id=current_user.current_tenant_id,
                access_token=access_token,
                source_info=source_info,
                provider='notion'
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
            'workspace_name': workspace_name,
            'workspace_icon': workspace_icon,
            'workspace_id': workspace_id,
            'pages': pages,
            'total': len(pages)
        }
        # save data source binding
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == 'notion',
                DataSourceOauthBinding.access_token == access_token
            )
        ).first()
        if data_source_binding:
            data_source_binding.source_info = source_info
            data_source_binding.disabled = False
            db.session.commit()
        else:
            new_data_source_binding = DataSourceOauthBinding(
                tenant_id=current_user.current_tenant_id,
                access_token=access_token,
                source_info=source_info,
                provider='notion'
            )
            db.session.add(new_data_source_binding)
            db.session.commit()

    def sync_data_source(self, binding_id: str):
        # save data source binding
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceOauthBinding.provider == 'notion',
                DataSourceOauthBinding.id == binding_id,
                DataSourceOauthBinding.disabled == False
            )
        ).first()
        if data_source_binding:
            # get all authorized pages
            pages = self.get_authorized_pages(data_source_binding.access_token)
            source_info = data_source_binding.source_info
            new_source_info = {
                'workspace_name': source_info['workspace_name'],
                'workspace_icon': source_info['workspace_icon'],
                'workspace_id': source_info['workspace_id'],
                'pages': pages,
                'total': len(pages)
            }
            data_source_binding.source_info = new_source_info
            data_source_binding.disabled = False
            db.session.commit()
        else:
            raise ValueError('Data source binding not found')

    def get_authorized_pages(self, access_token: str):
        pages = []
        page_results = self.notion_page_search(access_token)
        database_results = self.notion_database_search(access_token)
        # get page detail
        for page_result in page_results:
            page_id = page_result['id']
            page_name = 'Untitled'
            for key in ['Name', 'title', 'Title', 'Page']:
                if key in page_result['properties']:
                    if len(page_result['properties'][key].get('title', [])) > 0:
                        page_name = page_result['properties'][key]['title'][0]['plain_text']
                        break
            page_icon = page_result['icon']
            if page_icon:
                icon_type = page_icon['type']
                if icon_type == 'external' or icon_type == 'file':
                    url = page_icon[icon_type]['url']
                    icon = {
                        'type': 'url',
                        'url': url if url.startswith('http') else f'https://www.notion.so{url}'
                    }
                else:
                    icon = {
                        'type': 'emoji',
                        'emoji': page_icon[icon_type]
                    }
            else:
                icon = None
            parent = page_result['parent']
            parent_type = parent['type']
            if parent_type == 'block_id':
                parent_id = self.notion_block_parent_page_id(access_token, parent[parent_type])
            elif parent_type == 'workspace':
                parent_id = 'root'
            else:
                parent_id = parent[parent_type]
            page = {
                'page_id': page_id,
                'page_name': page_name,
                'page_icon': icon,
                'parent_id': parent_id,
                'type': 'page'
            }
            pages.append(page)
            # get database detail
        for database_result in database_results:
            page_id = database_result['id']
            if len(database_result['title']) > 0:
                page_name = database_result['title'][0]['plain_text']
            else:
                page_name = 'Untitled'
            page_icon = database_result['icon']
            if page_icon:
                icon_type = page_icon['type']
                if icon_type == 'external' or icon_type == 'file':
                    url = page_icon[icon_type]['url']
                    icon = {
                        'type': 'url',
                        'url': url if url.startswith('http') else f'https://www.notion.so{url}'
                    }
                else:
                    icon = {
                        'type': icon_type,
                        icon_type: page_icon[icon_type]
                    }
            else:
                icon = None
            parent = database_result['parent']
            parent_type = parent['type']
            if parent_type == 'block_id':
                parent_id = self.notion_block_parent_page_id(access_token, parent[parent_type])
            elif parent_type == 'workspace':
                parent_id = 'root'
            else:
                parent_id = parent[parent_type]
            page = {
                'page_id': page_id,
                'page_name': page_name,
                'page_icon': icon,
                'parent_id': parent_id,
                'type': 'database'
            }
            pages.append(page)
        return pages

    def notion_page_search(self, access_token: str):
        data = {
            'filter': {
                "value": "page",
                "property": "object"
            }
        }
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {access_token}",
            'Notion-Version': '2022-06-28',
        }
        response = requests.post(url=self._NOTION_PAGE_SEARCH, json=data, headers=headers)
        response_json = response.json()
        if 'results' in response_json:
            results = response_json['results']
        else:
            results = []
        return results

    def notion_block_parent_page_id(self, access_token: str, block_id: str):
        headers = {
            'Authorization': f"Bearer {access_token}",
            'Notion-Version': '2022-06-28',
        }
        response = requests.get(url=f'{self._NOTION_BLOCK_SEARCH}/{block_id}', headers=headers)
        response_json = response.json()
        parent = response_json['parent']
        parent_type = parent['type']
        if parent_type == 'block_id':
            return self.notion_block_parent_page_id(access_token, parent[parent_type])
        return parent[parent_type]

    def notion_workspace_name(self, access_token: str):
        headers = {
            'Authorization': f"Bearer {access_token}",
            'Notion-Version': '2022-06-28',
        }
        response = requests.get(url=self._NOTION_BOT_USER, headers=headers)
        response_json = response.json()
        if 'object' in response_json and response_json['object'] == 'user':
            user_type = response_json['type']
            user_info = response_json[user_type]
            if 'workspace_name' in user_info:
                return user_info['workspace_name']
        return 'workspace'

    def notion_database_search(self, access_token: str):
        data = {
            'filter': {
                "value": "database",
                "property": "object"
            }
        }
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {access_token}",
            'Notion-Version': '2022-06-28',
        }
        response = requests.post(url=self._NOTION_PAGE_SEARCH, json=data, headers=headers)
        response_json = response.json()
        if 'results' in response_json:
            results = response_json['results']
        else:
            results = []
        return results
