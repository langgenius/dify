"""Offline transports: real SQL over append-only logs and serialized Celery deliveries.

These replace external systems, never repository methods or their query results.
The SQL transport executes the repository's window/filter/aggregate expressions in
SQLite. Provider dialect, indexing latency and broker delivery need integration
coverage; this transport deliberately makes no claim to emulate those systems.
"""

import re
import sqlite3
import time
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import override
from zoneinfo import ZoneInfo

from aliyun.log import GetLogsRequest, LogClient, LogItem, PutLogsRequest
from aliyun.log.putlogsresponse import PutLogsResponse
from kombu.serialization import dumps, loads

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG
from repositories.workflow.logstore.schema import workflow_logstore_indexes


class _SDKEndpoint(LogClient):
    def __init__(
        self,
        put: Callable[[PutLogsRequest], None],
        get: Callable[[GetLogsRequest], "LogResponse"],
    ) -> None:
        self._put = put
        self._get = get

    @override
    def put_logs(self, request: object) -> PutLogsResponse:
        assert isinstance(request, PutLogsRequest)
        self._put(request)
        return PutLogsResponse({})

    @override
    def get_logs(self, request: GetLogsRequest) -> "LogResponse":
        return self._get(request)


class _PGEndpoint(AliyunLogStorePG):
    def __init__(
        self,
        put: Callable[[str, Sequence[tuple[str, str]], bool], None],
        query: Callable[[str, str, bool], list[dict[str, object]]],
    ) -> None:
        self._put = put
        self._query = query

    @override
    def put_log(self, logstore: str, contents: Sequence[tuple[str, str]], log_enabled: bool = False) -> None:
        self._put(logstore, contents, log_enabled)

    @override
    def execute_sql(self, sql: str, logstore: str, log_enabled: bool = False) -> list[dict[str, object]]:
        return self._query(sql, logstore, log_enabled)


class _ContractAliyunLogStore(AliyunLogStore):
    """Initialize the production adapter with deterministic local endpoints."""

    _instance: AliyunLogStore | None = None

    def __new__(
        cls,
        transport: "AppendOnlyLogStore",
        *,
        pg: bool,
    ) -> "_ContractAliyunLogStore":
        del transport, pg
        instance = super().__new__(cls)
        if not isinstance(instance, cls):
            raise TypeError(f"Expected {cls.__name__}, got {type(instance).__name__}")
        return instance

    def __init__(self, transport: "AppendOnlyLogStore", *, pg: bool) -> None:
        self.project_name = "contract-project"
        self.log_enabled = False
        self._use_pg_protocol = pg
        self.client = _SDKEndpoint(transport._sdk_put, transport._sdk_get)
        self._pg_client = _PGEndpoint(transport._pg_put, transport._pg_query)

    @classmethod
    def create(cls, transport: "AppendOnlyLogStore", *, pg: bool) -> "_ContractAliyunLogStore":
        # The production adapter is a process singleton. Contract transports need
        # independent local endpoints, so reset only the test subclass singleton.
        cls._instance = None
        return cls(transport, pg=pg)


def convert_tz(value: str, source: str, target: str) -> str:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(source))
    return parsed.astimezone(ZoneInfo(target)).replace(tzinfo=None).isoformat()


def unix_time(value: str) -> float:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC).timestamp() if parsed.tzinfo is None else parsed.timestamp()


class AppendOnlyLogStore:
    def __init__(self, *, pg: bool) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        # Scalar dialect functions only; SQLite still evaluates all SQL relations.
        self.connection.create_function("from_iso8601_timestamp", 1, lambda value: value)
        self.connection.create_function("to_unixtime", 1, unix_time)
        self.connection.create_function(
            "from_unixtime", 1, lambda value: datetime.fromtimestamp(value, UTC).isoformat()
        )
        self.connection.create_function(
            "from_unixtime", 2, lambda value, zone: datetime.fromtimestamp(value, ZoneInfo(zone)).isoformat()
        )
        self.connection.create_function(
            "date_format", 2, lambda value, fmt: datetime.fromisoformat(value).strftime(fmt)
        )
        self.failure: Exception | None = None
        # Exercise the production SDK/PG routing, with only the remote endpoints replaced.
        self.client = _ContractAliyunLogStore.create(self, pg=pg)
        for name, config in workflow_logstore_indexes().items():
            columns = []
            for field, key in config.key_config_list.items():
                kind = {"long": "INTEGER", "double": "REAL"}.get(key.index_type, "TEXT")
                columns.append(f'"{field}" {kind}')
            self.connection.execute(f'CREATE TABLE "{name}" (__time__ INTEGER, {", ".join(columns)})')

    def close(self) -> None:
        self.connection.close()

    def put_log(self, logstore: str, contents: Sequence[tuple[str, str]]) -> None:
        if self.failure:
            raise self.failure
        record = dict(contents)
        names = ", ".join(f'"{field}"' for field in record)
        placeholders = ", ".join("?" for _ in record)
        self.connection.execute(
            f'INSERT INTO "{logstore}" (__time__, {names}) VALUES (?, {placeholders})',
            [int(time.time()), *record.values()],
        )

    def _query(self, sql: str) -> list[dict[str, object]]:
        if self.failure:
            raise self.failure
        # SQLite accepts this syntax; SLS explicitly rejects it. This guard is
        # a regression check, not a substitute for the live SLS dialect suite.
        if re.search(r"\bLIMIT\s+\d+\s+OFFSET\s+\d+", sql, re.IGNORECASE):
            raise ValueError("SLS pagination requires LIMIT offset, count")
        # SQL is executed as supplied: no precomputed repository answers.
        return [dict(row) for row in self.connection.execute(sql)]

    def _sdk_put(self, request: PutLogsRequest) -> None:
        assert request.get_project() == "contract-project"
        items = request.get_log_items()
        assert isinstance(items, list)
        for item in items:
            assert isinstance(item, LogItem)
            self.put_log(request.get_logstore(), item.get_contents())

    def _sdk_get(self, request: GetLogsRequest) -> "LogResponse":
        assert request.get_project() == "contract-project"
        assert request.get_logstore() in workflow_logstore_indexes()
        assert request.get_from() == 0
        to_time = request.get_to()
        assert isinstance(to_time, int)
        assert to_time > 0
        query = request.get_query()
        assert isinstance(query, str)
        search, sql = query.split("|", 1)
        assert search.strip() == "*"
        return LogResponse([LogEntry(row) for row in self._query(sql)])

    def _pg_put(self, logstore: str, contents: Sequence[tuple[str, str]], log_enabled: bool) -> None:
        assert log_enabled is False
        self.put_log(logstore, contents)

    def _pg_query(self, sql: str, logstore: str, log_enabled: bool) -> list[dict[str, object]]:
        assert log_enabled is False
        assert logstore in workflow_logstore_indexes()
        # SLS otherwise silently applies its default (recent-data) query window.
        assert "__time__ > 0" in sql
        return self._query(sql)


@dataclass
class LogEntry:
    row: dict[str, object]

    def get_contents(self) -> dict[str, str]:
        # SDK contents are strings; PG result cells preserve numeric types.
        return {key: str(value) for key, value in self.row.items() if value is not None}


@dataclass
class LogResponse:
    logs: list[LogEntry]

    def get_logs(self) -> list[LogEntry]:
        return self.logs


class TaskDeliveries:
    def __init__(self) -> None:
        self.pending: deque[tuple[Callable[..., bool], dict[str, object]]] = deque()
        self.failure: Exception | None = None

    def sender(self, worker: Callable[..., bool]) -> Callable[..., None]:
        def send(**payload: object) -> None:
            if self.failure:
                raise self.failure
            content_type, encoding, body = dumps(payload, serializer="json")
            self.pending.append((worker, loads(body, content_type=content_type, content_encoding=encoding)))

        return send

    def drain(self) -> None:
        while self.pending:
            worker, payload = self.pending.popleft()
            assert worker(**payload) is True
