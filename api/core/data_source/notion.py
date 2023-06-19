"""Notion reader."""
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests  # type: ignore

from llama_index.readers.base import BaseReader
from llama_index.readers.schema.base import Document

INTEGRATION_TOKEN_NAME = "NOTION_INTEGRATION_TOKEN"
BLOCK_CHILD_URL_TMPL = "https://api.notion.com/v1/blocks/{block_id}/children"
DATABASE_URL_TMPL = "https://api.notion.com/v1/databases/{database_id}/query"
SEARCH_URL = "https://api.notion.com/v1/search"
RETRIEVE_PAGE_URL_TMPL = "https://api.notion.com/v1/pages/{page_id}"
RETRIEVE_DATABASE_URL_TMPL = "https://api.notion.com/v1/databases/{database_id}"
HEADING_TYPE = ['heading_1', 'heading_2', 'heading_3']
logger = logging.getLogger(__name__)


# TODO: Notion DB reader coming soon!
class NotionPageReader(BaseReader):
    """Notion Page reader.

    Reads a set of Notion pages.

    Args:
        integration_token (str): Notion integration token.

    """

    def __init__(self, integration_token: Optional[str] = None) -> None:
        """Initialize with parameters."""
        if integration_token is None:
            integration_token = os.getenv(INTEGRATION_TOKEN_NAME)
            if integration_token is None:
                raise ValueError(
                    "Must specify `integration_token` or set environment "
                    "variable `NOTION_INTEGRATION_TOKEN`."
                )
        self.token = integration_token
        self.headers = {
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        }

    def _read_block(self, block_id: str, num_tabs: int = 0) -> str:
        """Read a block."""
        done = False
        result_lines_arr = []
        cur_block_id = block_id
        while not done:
            block_url = BLOCK_CHILD_URL_TMPL.format(block_id=cur_block_id)
            query_dict: Dict[str, Any] = {}

            res = requests.request(
                "GET", block_url, headers=self.headers, json=query_dict
            )
            data = res.json()
            if 'results' not in data or data["results"] is None:
                done = True
                break
            heading = ''
            for result in data["results"]:
                result_type = result["type"]
                result_obj = result[result_type]
                cur_result_text_arr = []
                if result_type == 'table':
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
                                if result_type in HEADING_TYPE:
                                    heading = text
                    result_block_id = result["id"]
                    has_children = result["has_children"]
                    block_type = result["type"]
                    if has_children and block_type != 'child_page':
                        children_text = self._read_block(
                            result_block_id, num_tabs=num_tabs + 1
                        )
                        cur_result_text_arr.append(children_text)

                    cur_result_text = "\n".join(cur_result_text_arr)
                    if result_type in HEADING_TYPE:
                        result_lines_arr.append(cur_result_text)
                    else:
                        result_lines_arr.append(f'{heading}\n{cur_result_text}')

            if data["next_cursor"] is None:
                done = True
                break
            else:
                cur_block_id = data["next_cursor"]

        result_lines = "\n".join(result_lines_arr)
        return result_lines

    def _read_table_rows(self, block_id: str) -> str:
        """Read table rows."""
        done = False
        result_lines_arr = []
        cur_block_id = block_id
        while not done:
            block_url = BLOCK_CHILD_URL_TMPL.format(block_id=cur_block_id)
            query_dict: Dict[str, Any] = {}

            res = requests.request(
                "GET", block_url, headers=self.headers, json=query_dict
            )
            data = res.json()
            # get table headers text
            table_header_cell_texts = []
            tabel_header_cells = data["results"][0]['table_row']['cells']
            for tabel_header_cell in tabel_header_cells:
                if tabel_header_cell:
                    for table_header_cell_text in tabel_header_cell:
                        text = table_header_cell_text["text"]["content"]
                        table_header_cell_texts.append(text)
            # get table columns text and format
            results = data["results"]
            for i in range(len(results)-1):
                column_texts = []
                tabel_column_cells = data["results"][i+1]['table_row']['cells']
                for j in range(len(tabel_column_cells)):
                    if tabel_column_cells[j]:
                        for table_column_cell_text in tabel_column_cells[j]:
                            column_text = table_column_cell_text["text"]["content"]
                            column_texts.append(f'{table_header_cell_texts[j]}:{column_text}')

                cur_result_text = "\n".join(column_texts)
                result_lines_arr.append(cur_result_text)

            if data["next_cursor"] is None:
                done = True
                break
            else:
                cur_block_id = data["next_cursor"]

        result_lines = "\n".join(result_lines_arr)
        return result_lines
    def _read_parent_blocks(self, block_id: str, num_tabs: int = 0) -> List[str]:
        """Read a block."""
        done = False
        result_lines_arr = []
        cur_block_id = block_id
        while not done:
            block_url = BLOCK_CHILD_URL_TMPL.format(block_id=cur_block_id)
            query_dict: Dict[str, Any] = {}

            res = requests.request(
                "GET", block_url, headers=self.headers, json=query_dict
            )
            data = res.json()
            # current block's heading
            heading = ''
            for result in data["results"]:
                result_type = result["type"]
                result_obj = result[result_type]
                cur_result_text_arr = []
                if result_type == 'table':
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
                                if result_type in HEADING_TYPE:
                                    heading = text

                    result_block_id = result["id"]
                    has_children = result["has_children"]
                    block_type = result["type"]
                    if has_children and block_type != 'child_page':
                        children_text = self._read_block(
                            result_block_id, num_tabs=num_tabs + 1
                        )
                        cur_result_text_arr.append(children_text)

                    cur_result_text = "\n".join(cur_result_text_arr)
                    cur_result_text += "\n\n"
                    if result_type in HEADING_TYPE:
                        result_lines_arr.append(cur_result_text)
                    else:
                        result_lines_arr.append(f'{heading}\n{cur_result_text}')

            if data["next_cursor"] is None:
                done = True
                break
            else:
                cur_block_id = data["next_cursor"]
        return result_lines_arr

    def read_page(self, page_id: str) -> str:
        """Read a page."""
        return self._read_block(page_id)

    def read_page_as_documents(self, page_id: str) -> List[str]:
        """Read a page as documents."""
        return self._read_parent_blocks(page_id)

    def query_database_data(
            self, database_id: str, query_dict: Dict[str, Any] = {}
    ) -> str:
        """Get all the pages from a Notion database."""
        res = requests.post\
                (
            DATABASE_URL_TMPL.format(database_id=database_id),
            headers=self.headers,
            json=query_dict,
        )
        data = res.json()
        database_content_list = []
        if 'results' not in data or data["results"] is None:
            return ""
        for result in data["results"]:
            properties = result['properties']
            data = {}
            for property_name, property_value in properties.items():
                type = property_value['type']
                if type == 'multi_select':
                    value = []
                    multi_select_list = property_value[type]
                    for multi_select in multi_select_list:
                        value.append(multi_select['name'])
                elif type == 'rich_text' or type == 'title':
                    if len(property_value[type]) > 0:
                        value = property_value[type][0]['plain_text']
                    else:
                        value = ''
                elif type == 'select' or type == 'status':
                    if property_value[type]:
                        value = property_value[type]['name']
                    else:
                        value = ''
                else:
                    value = property_value[type]
                data[property_name] = value
            database_content_list.append(json.dumps(data, ensure_ascii=False))

        return "\n\n".join(database_content_list)

    def query_database(
            self, database_id: str, query_dict: Dict[str, Any] = {}
    ) -> List[str]:
        """Get all the pages from a Notion database."""
        res = requests.post\
                (
            DATABASE_URL_TMPL.format(database_id=database_id),
            headers=self.headers,
            json=query_dict,
        )
        data = res.json()
        page_ids = []
        for result in data["results"]:
            page_id = result["id"]
            page_ids.append(page_id)

        return page_ids

    def search(self, query: str) -> List[str]:
        """Search Notion page given a text query."""
        done = False
        next_cursor: Optional[str] = None
        page_ids = []
        while not done:
            query_dict = {
                "query": query,
            }
            if next_cursor is not None:
                query_dict["start_cursor"] = next_cursor
            res = requests.post(SEARCH_URL, headers=self.headers, json=query_dict)
            data = res.json()
            for result in data["results"]:
                page_id = result["id"]
                page_ids.append(page_id)

            if data["next_cursor"] is None:
                done = True
                break
            else:
                next_cursor = data["next_cursor"]
        return page_ids

    def load_data(
            self, page_ids: List[str] = [], database_id: Optional[str] = None
    ) -> List[Document]:
        """Load data from the input directory.

        Args:
            page_ids (List[str]): List of page ids to load.

        Returns:
            List[Document]: List of documents.

        """
        if not page_ids and not database_id:
            raise ValueError("Must specify either `page_ids` or `database_id`.")
        docs = []
        if database_id is not None:
            # get all the pages in the database
            page_ids = self.query_database(database_id)
            for page_id in page_ids:
                page_text = self.read_page(page_id)
                docs.append(Document(page_text))
        else:
            for page_id in page_ids:
                page_text = self.read_page(page_id)
                docs.append(Document(page_text))

        return docs

    def load_data_as_documents(
            self, page_ids: List[str] = [], database_id: Optional[str] = None
    ) -> List[Document]:
        if not page_ids and not database_id:
            raise ValueError("Must specify either `page_ids` or `database_id`.")
        docs = []
        if database_id is not None:
            # get all the pages in the database
            page_text = self.query_database_data(database_id)
            docs.append(Document(page_text))
        else:
            for page_id in page_ids:
                page_text_list = self.read_page_as_documents(page_id)
                for page_text in page_text_list:
                    docs.append(Document(page_text))

        return docs

    def get_page_last_edited_time(self, page_id: str) -> str:
        retrieve_page_url = RETRIEVE_PAGE_URL_TMPL.format(page_id=page_id)
        query_dict: Dict[str, Any] = {}

        res = requests.request(
            "GET", retrieve_page_url, headers=self.headers, json=query_dict
        )
        data = res.json()
        return data["last_edited_time"]

    def get_database_last_edited_time(self, database_id: str) -> str:
        retrieve_page_url = RETRIEVE_DATABASE_URL_TMPL.format(database_id=database_id)
        query_dict: Dict[str, Any] = {}

        res = requests.request(
            "GET", retrieve_page_url, headers=self.headers, json=query_dict
        )
        data = res.json()
        return data["last_edited_time"]


if __name__ == "__main__":
    reader = NotionPageReader()
    logger.info(reader.search("What I"))
