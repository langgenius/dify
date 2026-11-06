import uuid
from contextlib import contextmanager
from unittest.mock import patch

from click.testing import CliRunner

from commands.storage import clear_orphaned_file_records


class _FakeConnection:
    """Minimal stand-in for a SQLAlchemy connection, answering by table name."""

    def __init__(self, file_id: str, binding_present: bool):
        self.file_id = file_id
        self.binding_present = binding_present
        self.statements: list[str] = []

    def execute(self, statement, _parameters=None):
        sql = str(statement)
        self.statements.append(sql)
        if sql.startswith("DELETE"):
            return []
        if "FROM message_files mf" in sql:
            return []
        if "FROM upload_files" in sql:
            return [(self.file_id, "upload-files/key")]
        if "FROM tool_files" in sql:
            return []
        if "FROM segment_attachment_bindings" in sql:
            return [(self.file_id,)] if self.binding_present else []
        return []


class _FakeEngine:
    def __init__(self, file_id: str, binding_present: bool):
        self.connection = _FakeConnection(file_id, binding_present)

    @contextmanager
    def begin(self):
        yield self.connection


def _run_command(file_id: str, binding_present: bool):
    engine = _FakeEngine(file_id, binding_present)
    with patch("commands.storage.db") as mock_db:
        mock_db.engine = engine
        result = CliRunner().invoke(clear_orphaned_file_records, ["-f"])
    return result, engine


def test_attachment_binding_reference_is_not_orphaned():
    """A file referenced by segment_attachment_bindings.attachment_id must survive."""
    file_id = str(uuid.uuid4())
    result, engine = _run_command(file_id, binding_present=True)
    assert result.exit_code == 0, result.output
    assert "No orphaned file records found" in result.output
    assert not any(statement.startswith("DELETE") for statement in engine.connection.statements)


def test_unreferenced_file_is_still_deleted():
    """Control: a file with no reference anywhere is still treated as orphaned."""
    file_id = str(uuid.uuid4())
    result, engine = _run_command(file_id, binding_present=False)
    assert result.exit_code == 0, result.output
    assert "Found 1 orphaned file records" in result.output
    assert any(statement.startswith("DELETE") for statement in engine.connection.statements)
