import time
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


def convert_time_str_to_seconds(time_str: str) -> int:
    """
    Convert a time string to seconds.
    example: 1s -> 1,  1m30s -> 90, 1h30m -> 5400, 1h30m30s -> 5430
    """
    time_str = time_str.lower().strip().replace(" ", "")
    seconds = 0
    if "h" in time_str:
        hours, time_str = time_str.split("h")
        seconds += int(hours) * 3600
    if "m" in time_str:
        minutes, time_str = time_str.split("m")
        seconds += int(minutes) * 60
    if "s" in time_str:
        seconds += int(time_str.replace("s", ""))
    return seconds


class CrossRefQueryTitleAPI:
    """
    Tool for querying the metadata of a publication using its title.
    Crossref API doc: https://github.com/CrossRef/rest-api-doc
    """

    query_url_template: str = "https://api.crossref.org/works?query.bibliographic={query}&rows={rows}&offset={offset}&sort={sort}&order={order}&mailto={mailto}"
    rate_limit: int = 50
    rate_interval: float = 1
    max_limit: int = 1000

    def __init__(self, mailto: str):
        self.mailto = mailto

    def _query(
        self,
        query: str,
        rows: int = 5,
        offset: int = 0,
        sort: str = "relevance",
        order: str = "desc",
        fuzzy_query: bool = False,
    ) -> list[dict]:
        """
        Query the metadata of a publication using its title.
        :param query: the title of the publication
        :param rows: the number of results to return
        :param sort: the sort field
        :param order: the sort order
        :param fuzzy_query: whether to return all items that match the query
        """
        url = self.query_url_template.format(
            query=query, rows=rows, offset=offset, sort=sort, order=order, mailto=self.mailto
        )
        response = requests.get(url)
        response.raise_for_status()
        rate_limit = int(response.headers["x-ratelimit-limit"])
        # convert time string to seconds
        rate_interval = convert_time_str_to_seconds(response.headers["x-ratelimit-interval"])

        self.rate_limit = rate_limit
        self.rate_interval = rate_interval

        response = response.json()
        if response["status"] != "ok":
            return []

        message = response["message"]
        if fuzzy_query:
            # fuzzy query return all items
            return message["items"]
        else:
            for paper in message["items"]:
                title = paper["title"][0]
                if title.lower() != query.lower():
                    continue
                return [paper]
        return []

    def query(
        self, query: str, rows: int = 5, sort: str = "relevance", order: str = "desc", fuzzy_query: bool = False
    ) -> list[dict]:
        """
        Query the metadata of a publication using its title.
        :param query: the title of the publication
        :param rows: the number of results to return
        :param sort: the sort field
        :param order: the sort order
        :param fuzzy_query: whether to return all items that match the query
        """
        rows = min(rows, self.max_limit)
        if rows > self.rate_limit:
            # query multiple times
            query_times = rows // self.rate_limit + 1
            results = []

            for i in range(query_times):
                result = self._query(
                    query,
                    rows=self.rate_limit,
                    offset=i * self.rate_limit,
                    sort=sort,
                    order=order,
                    fuzzy_query=fuzzy_query,
                )
                if fuzzy_query:
                    results.extend(result)
                else:
                    # fuzzy_query=False, only one result
                    if result:
                        return result
                time.sleep(self.rate_interval)
            return results
        else:
            # query once
            return self._query(query, rows, sort=sort, order=order, fuzzy_query=fuzzy_query)


class CrossRefQueryTitleTool(BuiltinTool):
    """
    Tool for querying the metadata of a publication using its title.
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        query = tool_parameters.get("query")
        fuzzy_query = tool_parameters.get("fuzzy_query", False)
        rows = tool_parameters.get("rows", 3)
        sort = tool_parameters.get("sort", "relevance")
        order = tool_parameters.get("order", "desc")
        mailto = self.runtime.credentials["mailto"]

        result = CrossRefQueryTitleAPI(mailto).query(query, rows, sort, order, fuzzy_query)

        return [self.create_json_message(r) for r in result]
