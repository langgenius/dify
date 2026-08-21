import os
import re
from typing import Any

import orjson
import pytest
import requests
from _pytest.monkeypatch import MonkeyPatch
from pymochow.model.enum import ServerErrCode


class InMemoryMochowHTTP:
    """Serve deterministic Mochow API responses at the requests boundary."""

    def __init__(self) -> None:
        self.databases = {"dify"}
        self.tables: dict[str, dict[str, Any]] = {}
        self.rows: dict[str, dict[str, dict[str, Any]]] = {}

    @staticmethod
    def _response(url: str, payload: dict[str, Any], status_code: int = 200) -> requests.Response:
        response = requests.Response()
        response.status_code = status_code
        response.url = url
        response.headers["content-type"] = "application/json"
        response._content = orjson.dumps(payload)
        return response

    @staticmethod
    def _action(params: dict[Any, Any] | None) -> str:
        if not params:
            return ""
        key = next(iter(params))
        return key.decode() if isinstance(key, bytes) else str(key)

    def request(
        self,
        method: str,
        url: str | bytes,
        *,
        data: bytes | None = None,
        params: dict[Any, Any] | None = None,
        **_: Any,
    ) -> requests.Response:
        if isinstance(url, bytes):
            url = url.decode()
        body = orjson.loads(data) if data else {}
        action = self._action(params)
        resource = url.rstrip("/").rsplit("/", 1)[-1]

        if resource == "database":
            if action == "list":
                return self._response(url, {"code": 0, "msg": "Success", "databases": sorted(self.databases)})
            if action == "create":
                self.databases.add(body["database"])
            return self._response(url, {"code": 0, "msg": "Success"})

        if resource == "table":
            table_name = body.get("table") or self._param(params, "table")
            if method == "DELETE":
                if table_name not in self.tables:
                    return self._not_found(url)
                self.tables.pop(table_name, None)
                self.rows.pop(table_name, None)
                return self._response(url, {"code": 0, "msg": "Success"})
            if action == "create":
                self.tables[table_name] = body
                self.rows[table_name] = {}
                return self._response(url, {"code": 0, "msg": "Success"})
            if action == "desc":
                table = self.tables.get(table_name)
                if table is None:
                    return self._not_found(url)
                return self._response(
                    url,
                    {
                        "code": 0,
                        "msg": "Success",
                        "table": {
                            **table,
                            "description": table.get("description", "Table for Dify"),
                            "createTime": "2026-01-01T00:00:00Z",
                            "state": "NORMAL",
                            "aliases": [],
                        },
                    },
                )

        if resource == "index":
            if action == "desc":
                table = self.tables[body["table"]]
                index = next(item for item in table["schema"]["indexes"] if item["indexName"] == body["indexName"])
                return self._response(url, {"code": 0, "msg": "Success", "index": {**index, "state": "NORMAL"}})
            return self._response(url, {"code": 0, "msg": "Success"})

        if resource == "row":
            table_name = body["table"]
            table_rows = self.rows.setdefault(table_name, {})
            if action == "upsert":
                for row in body["rows"]:
                    table_rows[row["id"]] = row
                return self._response(
                    url,
                    {"code": 0, "msg": "Success", "affectedCount": len(body["rows"])},
                )
            if action == "query":
                primary_key = body["primaryKey"]["id"]
                return self._response(
                    url,
                    {"code": 0, "msg": "Success", "row": table_rows.get(primary_key, {})},
                )
            if action == "search":
                if "anns" not in body:
                    return self._response(url, {"code": 0, "msg": "Success", "rows": []})
                rows = [{"row": row, "distance": 0.1, "score": 0.9} for row in table_rows.values()]
                return self._response(url, {"code": 0, "msg": "Success", "rows": rows})
            if action == "delete":
                for doc_id in re.findall(r"'([^']+)'", body.get("filter", "")):
                    table_rows.pop(doc_id, None)
                return self._response(url, {"code": 0, "msg": "Success"})

        raise AssertionError(f"Unhandled Mochow request: {method} {url} action={action} body={body}")

    @staticmethod
    def _param(params: dict[Any, Any] | None, name: str) -> Any:
        for key, value in (params or {}).items():
            normalized_key = key.decode() if isinstance(key, bytes) else str(key)
            if normalized_key == name:
                return value.decode() if isinstance(value, bytes) else value
        return None

    def _not_found(self, url: str) -> requests.Response:
        return self._response(
            url,
            {"code": ServerErrCode.TABLE_NOT_EXIST.value, "msg": "Table not exist"},
            status_code=404,
        )


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_baiduvectordb_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        transport = InMemoryMochowHTTP()

        def post(session, url, **kwargs):
            return transport.request("POST", url, **kwargs)

        def delete(session, url, **kwargs):
            return transport.request("DELETE", url, **kwargs)

        monkeypatch.setattr(requests.Session, "post", post)
        monkeypatch.setattr(requests.Session, "delete", delete)
