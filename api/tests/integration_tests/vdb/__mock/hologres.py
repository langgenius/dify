import json
import os
from typing import Any

import holo_search_sdk as holo
import pytest
from _pytest.monkeypatch import MonkeyPatch
from psycopg import sql as psql

# Shared in-memory storage: {table_name: {doc_id: {"id", "text", "meta", "embedding"}}}
_mock_tables: dict[str, dict[str, dict[str, Any]]] = {}


class MockSearchQuery:
    """Mock query builder for search_vector and search_text results."""

    def __init__(self, table_name: str, search_type: str):
        self._table_name = table_name
        self._search_type = search_type
        self._limit_val = 10
        self._filter_sql = None

    def select(self, columns):
        return self

    def limit(self, n):
        self._limit_val = n
        return self

    def where(self, filter_sql):
        self._filter_sql = filter_sql
        return self

    def _apply_filter(self, row: dict[str, Any]) -> bool:
        """Apply the filter SQL to check if a row matches."""
        if self._filter_sql is None:
            return True

        # Extract literals (the document IDs) from the filter SQL
        # Filter format: meta->>'document_id' IN ('doc1', 'doc2')
        literals = [v for t, v in _extract_identifiers_and_literals(self._filter_sql) if t == "literal"]
        if not literals:
            return True

        # Get the document_id from the row's meta field
        meta = row.get("meta", "{}")
        if isinstance(meta, str):
            meta = json.loads(meta)
        doc_id = meta.get("document_id")

        return doc_id in literals

    def fetchall(self):
        data = _mock_tables.get(self._table_name, {})
        results = []
        for row in list(data.values())[: self._limit_val]:
            # Apply filter if present
            if not self._apply_filter(row):
                continue

            if self._search_type == "vector":
                # row format expected by _process_vector_results: (distance, id, text, meta)
                results.append((0.1, row["id"], row["text"], row["meta"]))
            else:
                # row format expected by _process_full_text_results: (id, text, meta, embedding, score)
                results.append((row["id"], row["text"], row["meta"], row.get("embedding", []), 0.9))
        return results


class MockTable:
    """Mock table object returned by client.open_table()."""

    def __init__(self, table_name: str):
        self._table_name = table_name

    def upsert_multi(self, index_column, values, column_names, update=True, update_columns=None):
        if self._table_name not in _mock_tables:
            _mock_tables[self._table_name] = {}
        id_idx = column_names.index("id")
        for row in values:
            doc_id = row[id_idx]
            _mock_tables[self._table_name][doc_id] = dict(zip(column_names, row))

    def search_vector(self, vector, column, distance_method, output_name):
        return MockSearchQuery(self._table_name, "vector")

    def search_text(self, column, expression, return_score=False, return_score_name="score", return_all_columns=False):
        return MockSearchQuery(self._table_name, "text")

    def set_vector_index(
        self, column, distance_method, base_quantization_type, max_degree, ef_construction, use_reorder
    ):
        pass

    def create_text_index(self, index_name, column, tokenizer):
        pass


def _extract_sql_template(query) -> str:
    """Extract the SQL template string from a psycopg Composed object."""
    if isinstance(query, psql.Composed):
        for part in query:
            if isinstance(part, psql.SQL):
                return part._obj
    if isinstance(query, psql.SQL):
        return query._obj
    return ""


def _extract_identifiers_and_literals(query) -> list[Any]:
    """Extract Identifier and Literal values from a psycopg Composed object."""
    values: list[Any] = []
    if isinstance(query, psql.Composed):
        for part in query:
            if isinstance(part, psql.Identifier):
                values.append(("ident", part._obj[0] if part._obj else ""))
            elif isinstance(part, psql.Literal):
                values.append(("literal", part._obj))
            elif isinstance(part, psql.Composed):
                # Handles SQL(...).join(...) for IN clauses
                for sub in part:
                    if isinstance(sub, psql.Literal):
                        values.append(("literal", sub._obj))
    return values


class MockHologresClient:
    """Mock holo_search_sdk client that stores data in memory."""

    def connect(self):
        pass

    def check_table_exist(self, table_name):
        return table_name in _mock_tables

    def open_table(self, table_name):
        return MockTable(table_name)

    def execute(self, query, fetch_result=False):
        template = _extract_sql_template(query)
        params = _extract_identifiers_and_literals(query)

        if "CREATE TABLE" in template.upper():
            # Extract table name from first identifier
            table_name = next((v for t, v in params if t == "ident"), "unknown")
            if table_name not in _mock_tables:
                _mock_tables[table_name] = {}
            return None

        if "SELECT 1" in template:
            # text_exists: SELECT 1 FROM {table} WHERE id = {id} LIMIT 1
            table_name = next((v for t, v in params if t == "ident"), "")
            doc_id = next((v for t, v in params if t == "literal"), "")
            data = _mock_tables.get(table_name, {})
            return [(1,)] if doc_id in data else []

        if "SELECT id" in template:
            # get_ids_by_metadata_field: SELECT id FROM {table} WHERE meta->>{key} = {value}
            table_name = next((v for t, v in params if t == "ident"), "")
            literals = [v for t, v in params if t == "literal"]
            key = literals[0] if len(literals) > 0 else ""
            value = literals[1] if len(literals) > 1 else ""
            data = _mock_tables.get(table_name, {})
            return [(doc_id,) for doc_id, row in data.items() if json.loads(row.get("meta", "{}")).get(key) == value]

        if "DELETE" in template.upper():
            table_name = next((v for t, v in params if t == "ident"), "")
            if "id IN" in template:
                # delete_by_ids
                ids_to_delete = [v for t, v in params if t == "literal"]
                for did in ids_to_delete:
                    _mock_tables.get(table_name, {}).pop(did, None)
            elif "meta->>" in template:
                # delete_by_metadata_field
                literals = [v for t, v in params if t == "literal"]
                key = literals[0] if len(literals) > 0 else ""
                value = literals[1] if len(literals) > 1 else ""
                data = _mock_tables.get(table_name, {})
                to_remove = [
                    doc_id for doc_id, row in data.items() if json.loads(row.get("meta", "{}")).get(key) == value
                ]
                for did in to_remove:
                    data.pop(did, None)
            return None

        return [] if fetch_result else None

    def drop_table(self, table_name):
        _mock_tables.pop(table_name, None)


def mock_connect(**kwargs):
    """Replacement for holo_search_sdk.connect() that returns a mock client."""
    return MockHologresClient()


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_hologres_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(holo, "connect", mock_connect)

    yield

    if MOCK:
        _mock_tables.clear()
        monkeypatch.undo()
