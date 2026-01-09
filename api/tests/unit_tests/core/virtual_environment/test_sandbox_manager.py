import threading
from collections.abc import Mapping
from io import BytesIO
from typing import Any

import pytest

from core.virtual_environment.__base.entities import Arch, CommandStatus, ConnectionHandle, FileState, Metadata
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.sandbox_manager import SandboxManager


class FakeVirtualEnvironment(VirtualEnvironment):
    def __init__(self, sandbox_id: str = "fake-id"):
        self._sandbox_id = sandbox_id
        super().__init__(tenant_id="test-tenant", options={}, environments={})

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        return Metadata(id=self._sandbox_id, arch=Arch.AMD64)

    def upload_file(self, path: str, content: BytesIO) -> None:
        raise NotImplementedError

    def download_file(self, path: str) -> BytesIO:
        raise NotImplementedError

    def list_files(self, directory_path: str, limit: int) -> list[FileState]:
        return []

    def establish_connection(self) -> ConnectionHandle:
        return ConnectionHandle(id="conn")

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        pass

    def release_environment(self) -> None:
        pass

    def execute_command(
        self, connection_handle: ConnectionHandle, command: list[str], environments: Mapping[str, str] | None = None
    ) -> tuple[str, Any, Any, Any]:
        raise NotImplementedError

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=0)

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        pass


@pytest.fixture(autouse=True)
def clean_sandbox_manager():
    SandboxManager.clear()
    yield
    SandboxManager.clear()


class TestSandboxManager:
    def test_register_and_get(self):
        sandbox = FakeVirtualEnvironment("sandbox-1")

        SandboxManager.register("exec-1", sandbox)
        result = SandboxManager.get("exec-1")

        assert result is sandbox

    def test_get_returns_none_for_unknown_id(self):
        result = SandboxManager.get("unknown-id")
        assert result is None

    def test_register_raises_on_empty_workflow_execution_id(self):
        sandbox = FakeVirtualEnvironment()

        with pytest.raises(ValueError, match="workflow_execution_id cannot be empty"):
            SandboxManager.register("", sandbox)

    def test_register_raises_on_duplicate(self):
        sandbox1 = FakeVirtualEnvironment("sandbox-1")
        sandbox2 = FakeVirtualEnvironment("sandbox-2")

        SandboxManager.register("exec-dup", sandbox1)

        with pytest.raises(RuntimeError, match="already registered"):
            SandboxManager.register("exec-dup", sandbox2)

    def test_unregister_returns_sandbox(self):
        sandbox = FakeVirtualEnvironment("sandbox-to-remove")
        SandboxManager.register("exec-remove", sandbox)

        result = SandboxManager.unregister("exec-remove")

        assert result is sandbox
        assert SandboxManager.get("exec-remove") is None

    def test_unregister_returns_none_for_unknown(self):
        result = SandboxManager.unregister("nonexistent")
        assert result is None

    def test_has_returns_true_when_registered(self):
        sandbox = FakeVirtualEnvironment()
        SandboxManager.register("exec-has", sandbox)

        assert SandboxManager.has("exec-has") is True

    def test_has_returns_false_when_not_registered(self):
        assert SandboxManager.has("exec-no") is False

    def test_clear_removes_all_sandboxes(self):
        sandbox1 = FakeVirtualEnvironment("s1")
        sandbox2 = FakeVirtualEnvironment("s2")
        SandboxManager.register("exec-1", sandbox1)
        SandboxManager.register("exec-2", sandbox2)

        SandboxManager.clear()

        assert SandboxManager.count() == 0
        assert SandboxManager.get("exec-1") is None
        assert SandboxManager.get("exec-2") is None

    def test_count_returns_number_of_sandboxes(self):
        assert SandboxManager.count() == 0

        SandboxManager.register("e1", FakeVirtualEnvironment("s1"))
        assert SandboxManager.count() == 1

        SandboxManager.register("e2", FakeVirtualEnvironment("s2"))
        assert SandboxManager.count() == 2

        SandboxManager.unregister("e1")
        assert SandboxManager.count() == 1

    def test_thread_safety(self):
        results: list[bool] = []
        errors: list[Exception] = []

        def register_sandbox(exec_id: str):
            try:
                sandbox = FakeVirtualEnvironment(f"sandbox-{exec_id}")
                SandboxManager.register(exec_id, sandbox)
                results.append(True)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=register_sandbox, args=(f"exec-{i}",)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert len(results) == 10
        assert SandboxManager.count() == 10
