import json
import logging
from typing import Optional

import requests

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from libs.oauth_data_source import FeishuWikiOAuth
from models.dataset import Document as DocumentModel
from models.source import DataSourceOauthBinding

logger = logging.getLogger(__name__)

FEISHU_WIKI_NODE_URL = "https://open.larkoffice.com/open-apis/wiki/v2/spaces/get_node"
FEISHU_PLUGIN_DOMAIN = "https://bytesec.bytedance.com/lark-plugin"


class FeishuWikiExtractor(BaseExtractor):

    def __init__(self, feishu_workspace_id: str,
                 obj_token: str,
                 obj_type: str,
                 tenant_id: str,
                 document_model: Optional[DocumentModel] = None):
        self._document_model = document_model
        self._feishu_workspace_id = feishu_workspace_id
        self._feishu_obj_token = obj_token
        self._feishu_obj_type = obj_type
        self._app_id, self._app_secret, self._tenant_access_token = self._get_app_info(tenant_id, feishu_workspace_id)

    def extract(self) -> list[Document]:
        self.update_last_edited_time(
            self._document_model
        )
        if self._feishu_obj_type == "docx":
            md_content = self.get_document_markdown_content(self._feishu_obj_token)
            return [Document(page_content=md_content)]
        else:
            raise ValueError("feishu obj type not supported")

    def get_document_markdown_content(self, document_id: str):
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Dify/1.0',
        }
        data = {
            "app_id": self._app_id,
            "app_secret": self._app_secret,
            "document_id": document_id,
            "doc_type": "docx"
        }
        response = requests.post(url=FEISHU_PLUGIN_DOMAIN + "/document/docx2md", headers=headers, timeout=(60, 120),
                                 json=data)
        response_json = response.json()
        if not response.ok:
            raise Exception(
                f"get get document markdown content fail！status_code：{response.status_code}, code: {response_json['code']}, msg：{response_json['msg']}")
        content = response_json.get('data', "")
        return content

    def update_last_edited_time(self, document_model: DocumentModel):
        if not document_model:
            return

        last_edited_time = self.get_feishu_wiki_node_last_edited_time()
        data_source_info = document_model.data_source_info_dict
        data_source_info['last_edited_time'] = last_edited_time
        update_params = {
            DocumentModel.data_source_info: json.dumps(data_source_info)
        }

        DocumentModel.query.filter_by(id=document_model.id).update(update_params)
        db.session.commit()

    def get_feishu_wiki_node_last_edited_time(self):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {self._tenant_access_token}",
        }
        params = {
            "token": self._feishu_obj_token,
            "obj_type": self._feishu_obj_type,
        }
        response = requests.get(url=FEISHU_WIKI_NODE_URL, params=params, headers=headers, timeout=(60,120))
        response_json = response.json()
        if not response.ok:
            raise Exception(
                f"get feishu wiki node fail！status_code：{response.status_code}, code: {response_json['code']}, msg：{response_json['msg']}")
        node = response_json["data"]["node"]
        return node["obj_edit_time"]

    @classmethod
    def _get_app_info(cls, tenant_id: str, feishu_workspace_id: str) -> (str, str):
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == tenant_id,
                DataSourceOauthBinding.provider == 'feishuwiki',
                DataSourceOauthBinding.disabled == False,
                DataSourceOauthBinding.source_info['workspace_id'] == f'"{feishu_workspace_id}"'
            )
        ).first()

        if not data_source_binding:
            raise Exception(f'No feishuwiki data source binding found for tenant {tenant_id} '
                            f'and feishuwiki workspace {feishu_workspace_id}')

        app_id = data_source_binding.source_info['workspace_name']
        app_secret = data_source_binding.access_token
        feishuwiki_oauth = FeishuWikiOAuth(app_id=app_id,
                                           app_secret=app_secret)
        return app_id, app_secret, feishuwiki_oauth.get_tenant_access_token()