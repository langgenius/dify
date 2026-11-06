from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass

import pytest
from click.testing import CliRunner
from sqlalchemy import TextClause

from commands import storage


class _FakeEngine:
    def __init__(self, rows_by_table: dict[str, list[tuple[str, ...]]]) -> None:
        self.rows_by_table = rows_by_table
        self.executed: list[str] = []

    @contextmanager
    def begin(self) -> Generator["_FakeEngine"]:
        yield self

    def execute(self, statement: TextClause, *_: object) -> list[tuple[str, ...]]:
        query = str(statement)
        self.executed.append(query)
        if query.startswith("SELECT"):
            table = query.split(" FROM ")[1].split()[0]
            return self.rows_by_table.get(table, [])
        return []


@dataclass
class _FakeDb:
    engine: _FakeEngine


def test_clear_orphaned_file_records_keeps_files_used_as_segment_attachments(monkeypatch: pytest.MonkeyPatch) -> None:
    attachment_id = "0198a6b2-6e4c-7c3a-9d1e-2f3b4c5d6e7f"
    engine = _FakeEngine(
        {
            "upload_files": [(attachment_id, "upload_files/tenant/image.png")],
            "segment_attachment_bindings": [(attachment_id,)],
        }
    )
    monkeypatch.setattr(storage, "db", _FakeDb(engine))

    result = CliRunner().invoke(storage.clear_orphaned_file_records, ["--force"])

    assert result.exit_code == 0
    assert "No orphaned file records found" in result.output
    assert not any(query.startswith("DELETE FROM upload_files") for query in engine.executed)
