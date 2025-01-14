import json
import logging
from typing import Any, Optional, cast

import requests

from configs import dify_config
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import Document as DocumentModel
from models.source import DataSourceOauthBinding

logger = logging.getLogger(__name__)

BLOCK_CHILD_URL_TMPL = "https://api.notion.com/v1/blocks/{block_id}/children"
DATABASE_URL_TMPL = "https://api.notion.com/v1/databases/{database_id}/query"
SEARCH_URL = "https://api.notion.com/v1/search"

RETRIEVE_PAGE_URL_TMPL = "https://api.notion.com/v1/pages/{page_id}"
RETRIEVE_DATABASE_URL_TMPL = "https://api.notion.com/v1/databases/{database_id}"
# if user want split by headings, use the corresponding splitter
HEADING_SPLITTER = {
    "heading_1": "# ",
    "heading_2": "## ",
    "heading_3": "### ",
}


class NotionExtractor(BaseExtractor):
    def __init__(
        self,
        notion_workspace_id: str,
        notion_obj_id: str,
        notion_page_type: str,
        tenant_id: str,
        document_model: Optional[DocumentModel] = None,
        notion_access_token: Optional[str] = None,
    ):
        self._notion_access_token = None
        self._document_model = document_model
        self._notion_workspace_id = notion_workspace_id
        self._notion_obj_id = notion_obj_id
        self._notion_page_type = notion_page_type
        if notion_access_token:
            self._notion_access_token = notion_access_token
        else:
            self._notion_access_token = self._get_access_token(tenant_id, self._notion_workspace_id)
            if not self._notion_access_token:
                integration_token = dify_config.NOTION_INTEGRATION_TOKEN
                if integration_token is None:
                    raise ValueError(
                        "Must specify `integration_token` or set environment variable `NOTION_INTEGRATION_TOKEN`."
                    )

                self._notion_access_token = integration_token

    def extract(self) -> list[Document]:
        self.update_last_edited_time(self._document_model)

        text_docs = self._load_data_as_documents(self._notion_obj_id, self._notion_page_type)

        return text_docs

    def _load_data_as_documents(self, notion_obj_id: str, notion_page_type: str) -> list[Document]:
        docs = []
        if notion_page_type == "database":
            # get all the pages in the database
            page_text_documents = self._get_notion_database_data(notion_obj_id)
            docs.extend(page_text_documents)
        elif notion_page_type == "page":
            page_text_list = self._get_notion_block_data(notion_obj_id)
            docs.append(Document(page_content="\n".join(page_text_list)))
        else:
            raise ValueError("notion page type not supported")

        return docs

    def _get_notion_database_data(self, database_id: str, query_dict: dict[str, Any] = {}) -> list[Document]:
        """Get all the pages from a Notion database."""
        assert self._notion_access_token is not None, "Notion access token is required"
        res = requests.post(
            DATABASE_URL_TMPL.format(database_id=database_id),
            headers={
                "Authorization": "Bearer " + self._notion_access_token,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
            },
            json=query_dict,
        )

        data = res.json()

        database_content = []
        if "results" not in data or data["results"] is None:
            return []
        for result in data["results"]:
            properties = result["properties"]
            data = {}
            value: Any
            for property_name, property_value in properties.items():
                type = property_value["type"]
                if type == "multi_select":
                    value = []
                    multi_select_list = property_value[type]
                    for multi_select in multi_select_list:
                        value.append(multi_select["name"])
                elif type in {"rich_text", "title"}:
                    if len(property_value[type]) > 0:
                        value = property_value[type][0]["plain_text"]
                    else:
                        value = ""
                elif type in {"select", "status"}:
                    if property_value[type]:
                        value = property_value[type]["name"]
                    else:
                        value = ""
                else:
                    value = property_value[type]
                data[property_name] = value
            row_dict = {k: v for k, v in data.items() if v}
            row_content = ""
            for key, value in row_dict.items():
                if isinstance(value, dict):
                    value_dict = {k: v for k, v in value.items() if v}
                    value_content = "".join(f"{k}:{v} " for k, v in value_dict.items())
                    row_content = row_content + f"{key}:{value_content}\n"
                else:
                    row_content = row_content + f"{key}:{value}\n"
            database_content.append(row_content)

        return [Document(page_content="\n".join(database_content))]

    def _get_notion_block_data(self, page_id: str) -> list[str]:
        assert self._notion_access_token is not None, "Notion access token is required"
        result_lines_arr = []
        start_cursor = None
        block_url = BLOCK_CHILD_URL_TMPL.format(block_id=page_id)
        while True:
            query_dict: dict[str, Any] = {} if not start_cursor else {"start_cursor": start_cursor}
            try:
                res = requests.request(
                    "GET",
                    block_url,
                    headers={
                        "Authorization": "Bearer " + self._notion_access_token,
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                    params=query_dict,
                )
                if res.status_code != 200:
                    raise ValueError(f"Error fetching Notion block data: {res.text}")
                data = res.json()
            except requests.RequestException as e:
                raise ValueError("Error fetching Notion block data") from e
            if "results" not in data or not isinstance(data["results"], list):
                raise ValueError("Error fetching Notion block data")
            for result in data["results"]:
                result_type = result["type"]
                result_obj = result[result_type]
                cur_result_text_arr = []
                if result_type == "table":
                    result_block_id = result["id"]
                    text = self._read_table_rows(result_block_id)
                    text += "\n\n"
                    result_lines_arr.append(text)
                else:
                    if "rich_text" in result_obj:
                        for rich_text in result_obj["rich_text"]:
                            # skip if doesn't have text object
                            if "text" in rich_text:
                                text = rich_text["text"]["content"]
                                cur_result_text_arr.append(text)

                    result_block_id = result["id"]
                    has_children = result["has_children"]
                    block_type = result["type"]
                    if has_children and block_type != "child_page":
                        children_text = self._read_block(result_block_id, num_tabs=1)
                        cur_result_text_arr.append(children_text)

                    cur_result_text = "\n".join(cur_result_text_arr)
                    if result_type in HEADING_SPLITTER:
                        result_lines_arr.append(f"{HEADING_SPLITTER[result_type]}{cur_result_text}")
                    else:
                        result_lines_arr.append(cur_result_text + "\n\n")

            if data["next_cursor"] is None:
                break
            else:
                start_cursor = data["next_cursor"]
        return result_lines_arr

    def _read_block(self, block_id: str, num_tabs: int = 0) -> str:
        """Read a block."""
        assert self._notion_access_token is not None, "Notion access token is required"
        result_lines_arr = []
        start_cursor = None
        block_url = BLOCK_CHILD_URL_TMPL.format(block_id=block_id)
        while True:
            query_dict: dict[str, Any] = {} if not start_cursor else {"start_cursor": start_cursor}

            res = requests.request(
                "GET",
                block_url,
                headers={
                    "Authorization": "Bearer " + self._notion_access_token,
                    "Content-Type": "application/json",
                    "Notion-Version": "2022-06-28",
                },
                params=query_dict,
            )
            data = res.json()
            if "results" not in data or data["results"] is None:
                break
            for result in data["results"]:
                result_type = result["type"]
                result_obj = result[result_type]
                cur_result_text_arr = []
                if result_type == "table":
                    result_block_id = result["id"]
                    text = self._read_table_rows(result_block_id)
                    result_lines_arr.append(text)
                else:
                    if "rich_text" in result_obj:
                        for rich_text in result_obj["rich_text"]:
                            # skip if doesn't have text object
                            if "text" in rich_text:
                                text = rich_text["text"]["content"]
                                prefix = "\t" * num_tabs
                                cur_result_text_arr.append(prefix + text)
                    result_block_id = result["id"]
                    has_children = result["has_children"]
                    block_type = result["type"]
                    if has_children and block_type != "child_page":
                        children_text = self._read_block(result_block_id, num_tabs=num_tabs + 1)
                        cur_result_text_arr.append(children_text)

                    cur_result_text = "\n".join(cur_result_text_arr)
                    if result_type in HEADING_SPLITTER:
                        result_lines_arr.append(f"{HEADING_SPLITTER[result_type]}{cur_result_text}")
                    else:
                        result_lines_arr.append(cur_result_text + "\n\n")

            if data["next_cursor"] is None:
                break
            else:
                start_cursor = data["next_cursor"]

        result_lines = "\n".join(result_lines_arr)
        return result_lines

    def _read_table_rows(self, block_id: str) -> str:
        """Read table rows."""
        assert self._notion_access_token is not None, "Notion access token is required"
        done = False
        result_lines_arr = []
        start_cursor = None
        block_url = BLOCK_CHILD_URL_TMPL.format(block_id=block_id)
        while not done:
            query_dict: dict[str, Any] = {} if not start_cursor else {"start_cursor": start_cursor}

            res = requests.request(
                "GET",
                block_url,
                headers={
                    "Authorization": "Bearer " + self._notion_access_token,
                    "Content-Type": "application/json",
                    "Notion-Version": "2022-06-28",
                },
                params=query_dict,
            )
            data = res.json()
            # get table headers text
            table_header_cell_texts = []
            table_header_cells = data["results"][0]["table_row"]["cells"]
            for table_header_cell in table_header_cells:
                if table_header_cell:
                    for table_header_cell_text in table_header_cell:
                        text = table_header_cell_text["text"]["content"]
                        table_header_cell_texts.append(text)
                else:
                    table_header_cell_texts.append("")
            # Initialize Markdown table with headers
            markdown_table = "| " + " | ".join(table_header_cell_texts) + " |\n"
            markdown_table += "| " + " | ".join(["---"] * len(table_header_cell_texts)) + " |\n"

            # Process data to format each row in Markdown table format
            results = data["results"]
            for i in range(len(results) - 1):
                column_texts = []
                table_column_cells = data["results"][i + 1]["table_row"]["cells"]
                for j in range(len(table_column_cells)):
                    if table_column_cells[j]:
                        for table_column_cell_text in table_column_cells[j]:
                            column_text = table_column_cell_text["text"]["content"]
                            column_texts.append(column_text)
                # Add row to Markdown table
                markdown_table += "| " + " | ".join(column_texts) + " |\n"
            result_lines_arr.append(markdown_table)
            if data["next_cursor"] is None:
                done = True
                break
            else:
                start_cursor = data["next_cursor"]

        result_lines = "\n".join(result_lines_arr)
        return result_lines

    def update_last_edited_time(self, document_model: Optional[DocumentModel]):
        if not document_model:
            return

        last_edited_time = self.get_notion_last_edited_time()
        data_source_info = document_model.data_source_info_dict
        data_source_info["last_edited_time"] = last_edited_time
        update_params = {DocumentModel.data_source_info: json.dumps(data_source_info)}

        DocumentModel.query.filter_by(id=document_model.id).update(update_params)
        db.session.commit()

    def get_notion_last_edited_time(self) -> str:
        assert self._notion_access_token is not None, "Notion access token is required"
        obj_id = self._notion_obj_id
        page_type = self._notion_page_type
        if page_type == "database":
            retrieve_page_url = RETRIEVE_DATABASE_URL_TMPL.format(database_id=obj_id)
        else:
            retrieve_page_url = RETRIEVE_PAGE_URL_TMPL.format(page_id=obj_id)

        query_dict: dict[str, Any] = {}

        res = requests.request(
            "GET",
            retrieve_page_url,
            headers={
                "Authorization": "Bearer " + self._notion_access_token,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
            },
            json=query_dict,
        )

        data = res.json()
        return cast(str, data["last_edited_time"])

    @classmethod
    def _get_access_token(cls, tenant_id: str, notion_workspace_id: str) -> str:
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == tenant_id,
                DataSourceOauthBinding.provider == "notion",
                DataSourceOauthBinding.disabled == False,
                DataSourceOauthBinding.source_info["workspace_id"] == f'"{notion_workspace_id}"',
            )
        ).first()

        if not data_source_binding:
            raise Exception(
                f"No notion data source binding found for tenant {tenant_id} "
                f"and notion workspace {notion_workspace_id}"
            )

        return cast(str, data_source_binding.access_token)
