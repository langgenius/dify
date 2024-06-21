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
DOCUMENT_BLOCK_CONTENT_URL = "https://open.feishu-boe.cn/open-apis/docx/v1/documents/{document_id}/blocks/{block_id}"
DOCUMENT_ALL_BLOCK_URL = "https://open.feishu-boe.cn/open-apis/docx/v1/documents/{document_id}/blocks"
LARK_WIKI_NODE_URL = "https://open.feishu-boe.cn/open-apis/wiki/v2/spaces/get_node"


class LarkWikiExtractor(BaseExtractor):

    def __init__(self, lark_workspace_id: str,
                 obj_token: str,
                 obj_type: str,
                 tenant_id: str,
                 document_model: Optional[DocumentModel] = None):
        self._document_model = document_model
        self._notion_workspace_id = lark_workspace_id
        self._lark_obj_token = obj_token
        self._lark_obj_type = obj_type
        self._tenant_access_token = self._get_tenant_access_token(tenant_id, lark_workspace_id)

    def extract(self) -> list[Document]:
        self.update_last_edited_time(
            self._document_model
        )
        if self._lark_obj_type == "docx":
            raw_content = self.get_document_raw_content(self._lark_obj_token)
            table_block_content = self.get_document_table_block_content(self._lark_obj_token, "")
            docs = [Document(page_content=raw_content), Document(page_content=table_block_content)]
            return docs
        else:
            raise ValueError("lark obj type not supported")

    def get_document_table_block_content(self, block_id: str, page_token: str) -> str:
        block_data_list = []

        cur_page_token = page_token
        while True:
            params = {
                "page_token": cur_page_token,
            }
            document_all_block_url = DOCUMENT_ALL_BLOCK_URL.format(document_id=block_id)

            response = requests.request(
                "GET",
                document_all_block_url,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f"Bearer {self._tenant_access_token}",
                },
                params=params
            )

            response_json = response.json()
            if not response_json or "data" not in response_json:
                return ""

            data = response_json["data"]
            items = data['items'] if "items" in data else []

            for item in items:
                block_type = item['block_type']
                if block_type == 31:
                    block_data_list.append(self.read_table_rows(item))
            if "page_token" in data:
                cur_page_token = data['page_token']

            if "has_more" in data:
                has_more = data['has_more']
                if not has_more:
                    break
            else:
                break

        return "\n".join(block_data_list)

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

    def get_document_block_content(self, document_id: str, block_id: str):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {self._tenant_access_token}",
        }
        response = requests.get(url=DOCUMENT_BLOCK_CONTENT_URL.format(document_id=document_id, block_id=block_id),
                                headers=headers,
                                timeout=30)
        response_json = response.json()
        if not response.ok:
            logger.error(
                f"get document block content fail！status_code：{response.status_code}, code: {response_json['code']}, msg：{response_json['msg']}")
            raise Exception(
                f"get document block content fail！status_code：{response.status_code}, code: {response_json['code']}, msg：{response_json['msg']}")

        res = response_json["data"]["block"]
        if not res:
            return ""

        if "children" in res:
            child_block_id_list = res["children"]
            if child_block_id_list:
                block_content_list = []
                for child_block_id in child_block_id_list:
                    block_content_list.append(self.get_document_block_content(document_id, child_block_id))
                return "\n".join(block_content_list)
        else:
            if res["block_type"] == 2 and "text" in res and "elements" in res["text"]:
                elements = res["text"]["elements"]
                block_content_list = []
                for element in elements:
                    if "text_run" in element:
                        block_content_list.append(element["text_run"]["content"])
                        return "\n".join(block_content_list)

    def read_table_rows(self, block) -> str:
        block_type = block["block_type"]
        parent_id = block["parent_id"]
        if block_type == 31:
            table_cells = block["table"]["cells"]
            column_size = block["table"]["property"]["column_size"]
            table_header_cells = table_cells[:column_size]
            table_header_cell_texts = []
            for block_id in table_header_cells:
                head_block_content = self.get_document_block_content(parent_id, block_id)
                table_header_cell_texts.append(head_block_content)

            result_lines_arr = []

            table_main_cells = table_cells[column_size:]
            for i in range(len(table_main_cells)):
                j = i % column_size
                main_block_content = self.get_document_block_content(parent_id, table_main_cells[i])
                result_lines_arr.append(f'{table_header_cell_texts[j]}:{main_block_content}')

            result_lines = "\n".join(result_lines_arr)
            return result_lines

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
    def _get_tenant_access_token(cls, tenant_id: str, lark_workspace_id: str) -> str:
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == tenant_id,
                DataSourceOauthBinding.provider == 'larkwiki',
                DataSourceOauthBinding.disabled == False,
                DataSourceOauthBinding.source_info['workspace_id'] == f'"{lark_workspace_id}"'
            )
        ).first()

        if not data_source_binding:
            raise Exception(f'No larkwiki data source binding found for tenant {tenant_id} '
                            f'and larkwiki workspace {lark_workspace_id}')

        app_id = data_source_binding.source_info['workspace_name']
        app_secret = data_source_binding.access_token

        larkwiki_oauth = LarkWikiOAuth(app_id=app_id,
                                       app_secret=app_secret)

        return larkwiki_oauth.get_tenant_access_token()
