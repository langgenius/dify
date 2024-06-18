import json
import logging
from typing import Optional

import requests

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from libs.oauth_data_source import LarkWikiOAuth
from models.dataset import Document as DocumentModel
from models.source import DataSourceOauthBinding

logger = logging.getLogger(__name__)

DOCUMENT_RAW_CONTENT_URL = "https://open.feishu-boe.cn/open-apis/docx/v1/documents/{document_id}/raw_content"
LARK_WIKI_NODE_URL = "https://open.feishu-boe.cn/open-apis/wiki/v2/spaces/get_node"


class LarkWikiExtractor(BaseExtractor):

    def __init__(self, workspace_id: str,
                 lark_obj_token: str,
                 lark_obj_type: str,
                 tenant_id: str,
                 document_model: Optional[DocumentModel] = None):
        self._document_model = document_model
        self._notion_workspace_id = workspace_id
        self._lark_obj_token = lark_obj_token
        self._lark_obj_type = lark_obj_type
        self._tenant_access_token = self._get_tenant_access_token(tenant_id, workspace_id)

    def extract(self) -> list[Document]:
        self.update_last_edited_time(
            self._document_model
        )
        if self._lark_obj_type == "docx":
            raw_content = self.get_document_raw_content(self._lark_obj_token)
            docs = [Document(page_content=raw_content)]
            return docs
        else:
            raise ValueError("lark obj type not supported")

    def get_document_raw_content(self, document_id: str):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {self._tenant_access_token}",
        }
        response = requests.get(url=DOCUMENT_RAW_CONTENT_URL.format(document_id=document_id), headers=headers,
                                timeout=30)
        response_json = response.json()
        if not response.ok:
            raise Exception(
                f"get get document raw content fail！status_code：{response.status_code}, code: {response_json['code']}, msg：{response_json['msg']}")

        content = response_json["data"]["content"]
        return content

    def update_last_edited_time(self, document_model: DocumentModel):
        if not document_model:
            return

        last_edited_time = self.get_lark_wiki_node_last_edited_time()
        data_source_info = document_model.data_source_info_dict
        data_source_info['last_edited_time'] = last_edited_time
        update_params = {
            DocumentModel.data_source_info: json.dumps(data_source_info)
        }

        DocumentModel.query.filter_by(id=document_model.id).update(update_params)
        db.session.commit()

    def get_lark_wiki_node_last_edited_time(self):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {self._tenant_access_token}",
        }
        params = {
            "token": self._lark_obj_token,
            "obj_type": self._lark_obj_type,
        }
        response = requests.get(url=LARK_WIKI_NODE_URL, params=params, headers=headers, timeout=30)
        response_json = response.json()
        if not response.ok:
            raise Exception(
                f"get lark wiki node fail！status_code：{response.status_code}, code: {response_json['code']}, msg：{response_json['msg']}")
        node = response_json["data"]["node"]
        return node["obj_edit_time"]

    @classmethod
    def _get_tenant_access_token(cls, tenant_id: str, workspace_id: str) -> str:
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == tenant_id,
                DataSourceOauthBinding.provider == 'larkwiki',
                DataSourceOauthBinding.disabled == False,
                DataSourceOauthBinding.source_info['workspace_id'] == f'"{workspace_id}"'
            )
        ).first()

        if not data_source_binding:
            raise Exception(f'No larkwiki data source binding found for tenant {tenant_id} '
                            f'and larkwiki workspace {workspace_id}')

        app_id = data_source_binding.source_info['workspace_name']
        app_secret = data_source_binding.access_token

        larkwiki_oauth = LarkWikiOAuth(app_id=app_id,
                                       app_secret=app_secret)

        return larkwiki_oauth.get_tenant_access_token()
