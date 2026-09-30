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
from typing import cast
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

from aliyun.log import GetLogsRequest, LogItem, PutLogsRequest
from kombu.serialization import dumps, loads

from extensions.logstore.aliyun_logstore import AliyunLogStore
from repositories.workflow.logstore.schema import workflow_logstore_indexes


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
        self.client = object.__new__(AliyunLogStore)
        self.client.project_name = "contract-project"
        self.client.log_enabled = False
        self.client._use_pg_protocol = pg
        self.client.client = MagicMock()
        self.client.client.put_logs.side_effect = self._sdk_put
        self.client.client.get_logs.side_effect = self._sdk_get
        pg_client = MagicMock()
        pg_client.put_log.side_effect = self._pg_put
        pg_client.execute_sql.side_effect = self._pg_query
        self.client._pg_client = pg_client
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
        for item in cast(list[LogItem], request.get_log_items()):
            self.put_log(request.get_logstore(), item.get_contents())

    def _sdk_get(self, request: GetLogsRequest) -> "LogResponse":
        assert request.get_project() == "contract-project"
        assert request.get_logstore() in workflow_logstore_indexes()
        assert request.get_from() == 0
        assert cast(int, request.get_to()) > 0
        search, sql = cast(str, request.get_query()).split("|", 1)
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
