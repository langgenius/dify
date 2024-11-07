from typing import Any

from dify_oapi.core.enum import HttpMethod


class BaseRequest:
    def __init__(self) -> None:
        self.http_method: HttpMethod | None = None
        self.uri: str | None = None
        self.body: dict | None = None
        self.paths: dict[str, str] = {}
        self.queries: list[tuple[str, str]] = []
        self.headers: dict[str, str] = {}
        self.body: dict = {}
        self.files: dict | None = None

    def add_query(self, k: str, v: Any) -> None:
        if isinstance(v, list | tuple):
            for i in v:
                self.queries.append((k, str(i)))
        else:
            self.queries.append((k, str(v)))
