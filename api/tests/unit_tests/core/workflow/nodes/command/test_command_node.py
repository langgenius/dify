import time
from collections.abc import Mapping
from io import BytesIO
from typing import Any
from unittest.mock import MagicMock

from core.entities.provider_entities import BasicProviderConfig
from core.virtual_environment.__base.entities import (
    Arch,
    CommandStatus,
    ConnectionHandle,
    FileState,
    Metadata,
    OperatingSystem,
)
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.transport import NopTransportWriteCloser
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.command.node import CommandNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


class FakeVirtualEnvironment(VirtualEnvironment):
    """Fake VirtualEnvironment for testing CommandNode execution."""

    def __init__(
        self,
        *,
        stdout: bytes = b"",
        stderr: bytes = b"",
        statuses: list[CommandStatus] | None = None,
        close_streams: bool = True,
    ) -> None:
        self._stdout_bytes = stdout
        self._stderr_bytes = stderr
        self._statuses = list(statuses or [])
        self._close_streams = close_streams
        self.last_execute_command: list[str] | None = None
        self.last_execute_cwd: str | None = None
        self.released_connections: list[str] = []
        super().__init__(tenant_id="test-tenant", options={}, environments={})

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        return Metadata(id="fake", arch=Arch.ARM64, os=OperatingSystem.LINUX)

    def upload_file(self, path: str, content: BytesIO) -> None:
        raise NotImplementedError

    def download_file(self, path: str) -> BytesIO:
        raise NotImplementedError

    def list_files(self, directory_path: str, limit: int) -> list[FileState]:
        return []

    def establish_connection(self) -> ConnectionHandle:
        return ConnectionHandle(id="conn")

    def release_connection(self, connection_handle: ConnectionHandle) -> None:
        self.released_connections.append(connection_handle.id)

    def release_environment(self) -> None:
        return

    def execute_command(
        self,
        connection_handle: ConnectionHandle,
        command: list[str],
        environments: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> tuple[str, NopTransportWriteCloser, QueueTransportReadCloser, QueueTransportReadCloser]:
        _ = connection_handle
        _ = environments
        self.last_execute_command = command
        self.last_execute_cwd = cwd

        stdout = QueueTransportReadCloser()
        stderr = QueueTransportReadCloser()

        if self._stdout_bytes:
            stdout.get_write_handler().write(self._stdout_bytes)
        if self._stderr_bytes:
            stderr.get_write_handler().write(self._stderr_bytes)

        if self._close_streams:
            stdout.close()
            stderr.close()

        return "pid", NopTransportWriteCloser(), stdout, stderr

    def get_command_status(self, connection_handle: ConnectionHandle, pid: str) -> CommandStatus:
        if self._statuses:
            return self._statuses.pop(0)
        return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=0)

    @classmethod
    def validate(cls, options: Mapping[str, Any]) -> None:
        pass

    @classmethod
    def get_config_schema(cls) -> list[BasicProviderConfig]:
        return []


def _make_mock_sandbox(vm: VirtualEnvironment) -> MagicMock:
    """Create a mock Sandbox wrapping a VirtualEnvironment for testing."""
    sandbox = MagicMock()
    sandbox.vm = vm
    sandbox.tenant_id = "test-tenant"
    sandbox.app_id = "test-app"
    sandbox.user_id = "test-user"
    sandbox.assets_id = "test-assets"
    sandbox.wait_ready = MagicMock()  # No-op for tests
    return sandbox


def _make_node(
    *,
    command: str,
    working_directory: str = "",
    workflow_execution_id: str = "test-workflow-exec-id",
    vm: FakeVirtualEnvironment | None = None,
) -> CommandNode:
    """Create a CommandNode for testing.

    Args:
        command: The shell command to execute.
        working_directory: Optional working directory for command execution.
        workflow_execution_id: Identifier for the workflow execution.
        vm: Optional FakeVirtualEnvironment. If provided, a mock Sandbox
            wrapping this VM will be set on the runtime state.
    """
    system_variables = SystemVariable(workflow_execution_id=workflow_execution_id)
    variable_pool = VariablePool(system_variables=system_variables, user_inputs={})
    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    init_params = GraphInitParams(
        tenant_id="t",
        app_id="a",
        workflow_id="w",
        graph_config={},
        user_id="u",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    if vm is not None:
        sandbox = _make_mock_sandbox(vm)
        runtime_state.set_sandbox(sandbox)

    return CommandNode(
        id="node-instance",
        config={
            "id": "node-config-id",
            "data": {
                "title": "Command",
                "command": command,
                "working_directory": working_directory,
            },
        },
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )


def test_command_node_success_executes_in_sandbox():
    vm = FakeVirtualEnvironment(stdout=b"ok\n", stderr=b"")
    node = _make_node(
        command="echo {{#pre_node_id.number#}}",
        working_directory="dir-{{#pre_node_id.number#}}",
        vm=vm,
    )
    node.graph_runtime_state.variable_pool.add(("pre_node_id", "number"), 42)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["stdout"] == "ok\n"
    assert result.outputs["stderr"] == ""
    assert result.outputs["exit_code"] == 0

    assert vm.last_execute_command is not None
    # CommandNode wraps commands in bash -c
    assert vm.last_execute_command == ["bash", "-c", "echo 42"]
    assert vm.last_execute_cwd == "dir-42"


def test_command_node_nonzero_exit_code_returns_failed_result():
    vm = FakeVirtualEnvironment(
        stdout=b"out",
        stderr=b"err",
        statuses=[CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=2)],
    )
    node = _make_node(command="false", vm=vm)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.outputs["exit_code"] == 2
    assert "exited with code" in result.error


def test_command_node_timeout_returns_failed_result_and_closes_transports(monkeypatch: Any):
    from core.workflow.nodes.command import node as command_node_module

    monkeypatch.setattr(command_node_module, "COMMAND_NODE_TIMEOUT_SECONDS", 1)

    vm = FakeVirtualEnvironment(
        stdout=b"",
        stderr=b"",
        statuses=[CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)] * 1000,
        close_streams=False,
    )
    node = _make_node(command="sleep 10", vm=vm)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "CommandTimeoutError"
    assert "timed out" in result.error


def test_command_node_no_sandbox_returns_failed():
    node = _make_node(command="echo hello")

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "SandboxNotInitializedError"
    assert "Sandbox not available" in result.error
