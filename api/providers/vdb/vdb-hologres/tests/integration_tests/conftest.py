import json
import os
import re
from typing import Any

import psycopg
import pytest
from _pytest.monkeypatch import MonkeyPatch


class InMemoryHologres:
    """Store rows while the real Hologres SDK builds and executes SQL."""

    def __init__(self) -> None:
        self.tables: dict[str, dict[str, dict[str, Any]]] = {}

    def execute(self, query: Any, params: tuple[Any, ...] | None = None) -> list[tuple[Any, ...]]:
        sql = query.as_string() if hasattr(query, "as_string") else str(query)
        normalized = " ".join(sql.split())

        if "FROM pg_tables" in normalized:
            table_name = re.findall(r"'([^']*)'", normalized)[-1]
            return [(table_name in self.tables,)]

        if match := re.search(r'CREATE TABLE IF NOT EXISTS "([^"]+)"', normalized, re.IGNORECASE):
            self.tables.setdefault(match.group(1), {})
            return []

        if match := re.search(r'DROP TABLE IF EXISTS "([^"]+)"', normalized, re.IGNORECASE):
            self.tables.pop(match.group(1), None)
            return []

        if match := re.search(r'INSERT INTO "([^"]+)" \(([^)]+)\)', normalized, re.IGNORECASE):
            table_name, raw_columns = match.groups()
            columns = re.findall(r'"([^"]+)"', raw_columns)
            values = params or ()
            table = self.tables.setdefault(table_name, {})
            for offset in range(0, len(values), len(columns)):
                row = dict(zip(columns, values[offset : offset + len(columns)]))
                table[row["id"]] = row
            return []

        if match := re.search(r'SELECT 1 FROM "([^"]+)" WHERE id = \'([^\']+)\'', normalized, re.IGNORECASE):
            table_name, doc_id = match.groups()
            return [(1,)] if doc_id in self.tables.get(table_name, {}) else []

        if match := re.search(
            r'SELECT id FROM "([^"]+)" WHERE meta->>\'([^\']+)\' = \'([^\']*)\'',
            normalized,
            re.IGNORECASE,
        ):
            table_name, key, value = match.groups()
            return [
                (doc_id,)
                for doc_id, row in self.tables.get(table_name, {}).items()
                if json.loads(row["meta"]).get(key) == value
            ]

        if match := re.search(r'DELETE FROM "([^"]+)" WHERE id IN \(([^)]+)\)', normalized, re.IGNORECASE):
            table_name, raw_ids = match.groups()
            for doc_id in re.findall(r"'([^']+)'", raw_ids):
                self.tables.get(table_name, {}).pop(doc_id, None)
            return []

        if match := re.search(
            r'DELETE FROM "([^"]+)" WHERE meta->>\'([^\']+)\' = \'([^\']*)\'',
            normalized,
            re.IGNORECASE,
        ):
            table_name, key, value = match.groups()
            table = self.tables.get(table_name, {})
            for doc_id in [doc_id for doc_id, row in table.items() if json.loads(row["meta"]).get(key) == value]:
                table.pop(doc_id, None)
            return []

        if normalized.upper().startswith("SELECT") and " FROM " in normalized.upper():
            table_match = re.search(r' FROM "([^"]+)"', normalized, re.IGNORECASE)
            if table_match is None:
                raise AssertionError(f"Could not identify Hologres table in SQL: {normalized}")
            rows = list(self.tables.get(table_match.group(1), {}).values())
            if filter_match := re.search(r"meta->>'document_id' IN \(([^)]+)\)", normalized):
                document_ids = set(re.findall(r"'([^']+)'", filter_match.group(1)))
                rows = [row for row in rows if json.loads(row["meta"]).get("document_id") in document_ids]
            if limit_match := re.search(r" LIMIT (\d+)", normalized, re.IGNORECASE):
                rows = rows[: int(limit_match.group(1))]
            if "approx_" in normalized:
                return [(0.1, row["id"], row["text"], row["meta"]) for row in rows]
            if "text_to_" in normalized or "TEXT_SEARCH" in normalized.upper():
                return [(row["id"], row["text"], row["meta"], row["embedding"], 0.9) for row in rows]

        if normalized.upper().startswith(("CALL ", "CREATE INDEX ")):
            return []

        raise AssertionError(f"Unhandled Hologres SQL: {normalized} params={params}")


class InMemoryCursor:
    def __init__(self, database: InMemoryHologres) -> None:
        self.database = database
        self.description = None
        self.results: list[tuple[Any, ...]] = []

    def execute(self, query, params=None):
        self.results = self.database.execute(query, params)
        return self

    def fetchone(self):
        return self.results[0] if self.results else None

    def fetchall(self):
        return list(self.results)

    def fetchmany(self, size=0):
        return self.results[:size] if size else list(self.results)

    def close(self) -> None:
        pass


class InMemoryConnection:
    def __init__(self, database: InMemoryHologres, autocommit: bool = False) -> None:
        self.database = database
        self.autocommit = autocommit

    def cursor(self) -> InMemoryCursor:
        return InMemoryCursor(self.database)

    def commit(self) -> None:
        pass

    def close(self) -> None:
        pass


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_hologres_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        database = InMemoryHologres()

        def connect(**kwargs):
            return InMemoryConnection(database, autocommit=kwargs.get("autocommit", False))

        monkeypatch.setattr(psycopg, "connect", connect)
