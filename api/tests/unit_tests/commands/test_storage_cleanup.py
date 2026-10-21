"""Safety boundaries for maintenance-only storage orphan deletion."""

from dataclasses import dataclass, field
from unittest.mock import patch

from click.testing import CliRunner

from commands import storage as storage_commands
from services.knowledge.file_cleanup_gate import FilePhysicalCleanupDisabledError


@dataclass
class _RecordingGate:
    failures: list[Exception | None] = field(default_factory=list)
    calls: int = 0

    def __call__(self) -> None:
        self.calls += 1
        if self.failures:
            failure = self.failures.pop(0)
            if failure is not None:
                raise failure


@dataclass
class _Storage:
    scan_results: list[list[str]]
    deleted: list[str] = field(default_factory=list)

    def scan(self, *, path: str, files: bool, directories: bool) -> list[str]:
        del path, files, directories
        return self.scan_results.pop(0)

    def delete(self, key: str) -> None:
        self.deleted.append(key)


def test_storage_orphan_cleanup_requires_stopped_writers() -> None:
    gate = _RecordingGate()

    with patch.object(storage_commands, "assert_physical_file_cleanup_enabled", gate):
        result = CliRunner().invoke(storage_commands.remove_orphaned_files_on_storage, ["--force"])

    assert result.exit_code == 2
    assert "all file writers are stopped and drained" in result.output
    assert gate.calls == 0


def test_storage_orphan_cleanup_requires_physical_cleanup_gate() -> None:
    gate = _RecordingGate(failures=[FilePhysicalCleanupDisabledError("cleanup disabled")])
    with patch.object(
        storage_commands,
        "assert_physical_file_cleanup_enabled",
        gate,
    ):
        result = CliRunner().invoke(
            storage_commands.remove_orphaned_files_on_storage,
            ["--force", "--writers-stopped"],
        )

    assert result.exit_code == 2
    assert "cleanup disabled" in result.output


def test_storage_orphan_cleanup_rechecks_current_database_owners() -> None:
    fake_storage = _Storage([[], [], ["upload_files/new", "upload_files/orphan"]])
    gate = _RecordingGate()

    with (
        patch.object(storage_commands, "storage", fake_storage),
        patch.object(
            storage_commands,
            "_registered_storage_keys",
            side_effect=[set(), {"upload_files/new"}],
        ),
        patch.object(storage_commands, "assert_physical_file_cleanup_enabled", gate),
    ):
        result = CliRunner().invoke(
            storage_commands.remove_orphaned_files_on_storage,
            ["--force", "--writers-stopped"],
        )

    assert result.exit_code == 0
    assert "Keeping 1 files that gained a database owner" in result.output
    assert fake_storage.deleted == ["upload_files/orphan"]
    assert gate.calls == 2


def test_storage_orphan_cleanup_stops_if_gate_closes_before_delete() -> None:
    fake_storage = _Storage([[], [], ["upload_files/orphan"]])
    gate = _RecordingGate(failures=[None, FilePhysicalCleanupDisabledError("cleanup disabled")])

    with (
        patch.object(storage_commands, "storage", fake_storage),
        patch.object(storage_commands, "_registered_storage_keys", side_effect=[set(), set()]),
        patch.object(
            storage_commands,
            "assert_physical_file_cleanup_enabled",
            gate,
        ),
    ):
        result = CliRunner().invoke(
            storage_commands.remove_orphaned_files_on_storage,
            ["--force", "--writers-stopped"],
        )

    assert result.exit_code == 1
    assert "cleanup disabled" in result.output
    assert fake_storage.deleted == []
