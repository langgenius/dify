import pytest

from tasks import ops_trace_task


class _Storage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def save(self, key: str, data: bytes) -> None:
        self.files[key] = data

    def delete(self, key: str) -> None:
        self.files.pop(key, None)


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> _Storage:
    fake = _Storage()
    monkeypatch.setattr(ops_trace_task, "storage", fake)
    return fake


def test_legacy_trace_tasks_are_drained(storage: _Storage) -> None:
    storage.save("ops_trace/app-1/file-1.json", b"{}")

    ops_trace_task.process_trace_tasks.run({"app_id": "app-1", "file_id": "file-1"})

    assert storage.files == {}


def test_legacy_trace_tasks_never_delete_outside_their_folder(storage: _Storage) -> None:
    storage.save("ops_trace/app-1/file-1.json", b"{}")

    ops_trace_task.process_trace_tasks.run({"app_id": "..", "file_id": "../secrets"})

    assert list(storage.files) == ["ops_trace/app-1/file-1.json"]
