"""Notion reader."""
import logging
import os
from typing import Any, Dict, List, Optional

import requests  # type: ignore

from llama_index.readers.base import BaseReader
from llama_index.readers.schema.base import Document

INTEGRATION_TOKEN_NAME = "NOTION_INTEGRATION_TOKEN"
BLOCK_CHILD_URL_TMPL = "https://api.notion.com/v1/blocks/{block_id}/children"
DATABASE_URL_TMPL = "https://api.notion.com/v1/databases/{database_id}/query"
SEARCH_URL = "https://api.notion.com/v1/search"

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

            for result in data["results"]:
                result_type = result["type"]
                result_obj = result[result_type]

                cur_result_text_arr = []
                if "rich_text" in result_obj:
                    for rich_text in result_obj["rich_text"]:
                        # skip if doesn't have text object
                        if "text" in rich_text:
                            text = rich_text["text"]["content"]
                            prefix = "\t" * num_tabs
                            cur_result_text_arr.append(prefix + text)

                result_block_id = result["id"]
                has_children = result["has_children"]
                if has_children:
                    children_text = self._read_block(
                        result_block_id, num_tabs=num_tabs + 1
                    )
                    cur_result_text_arr.append(children_text)

                cur_result_text = "\n".join(cur_result_text_arr)
                result_lines_arr.append(cur_result_text)

            if data["next_cursor"] is None:
                done = True
                break
            else:
                cur_block_id = data["next_cursor"]

        result_lines = "\n".join(result_lines_arr)
        return result_lines

    def read_page(self, page_id: str) -> str:
        """Read a page."""
        return self._read_block(page_id)

    def query_database(
        self, database_id: str, query_dict: Dict[str, Any] = {}
    ) -> List[str]:
        """Get all the pages from a Notion database."""
        res = requests.post(
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
                docs.append(Document(page_text, extra_info={"page_id": page_id}))
        else:
            for page_id in page_ids:
                page_text = self.read_page(page_id)
                docs.append(Document(page_text, extra_info={"page_id": page_id}))

        return docs


if __name__ == "__main__":
    reader = NotionPageReader()
    logger.info(reader.search("What I"))
