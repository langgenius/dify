import time
from collections.abc import Mapping
from io import BytesIO
from typing import Any

import pytest

from core.sandbox.manager import SandboxManager
from core.virtual_environment.__base.entities import Arch, CommandStatus, ConnectionHandle, FileState, Metadata
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.transport import NopTransportWriteCloser
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.command.node import CommandNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


class FakeSandbox(VirtualEnvironment):
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
        self.released_connections: list[str] = []
        super().__init__(tenant_id="test-tenant", options={}, environments={})

    def _construct_environment(self, options: Mapping[str, Any], environments: Mapping[str, str]) -> Metadata:
        return Metadata(id="fake", arch=Arch.ARM64)

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
        self, connection_handle: ConnectionHandle, command: list[str], environments: Mapping[str, str] | None = None
    ) -> tuple[str, NopTransportWriteCloser, QueueTransportReadCloser, QueueTransportReadCloser]:
        _ = connection_handle
        _ = environments
        self.last_execute_command = command

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


@pytest.fixture(autouse=True)
def clean_sandbox_manager():
    SandboxManager.clear()
    yield
    SandboxManager.clear()


def _make_node(
    *, command: str, working_directory: str = "", workflow_execution_id: str = "test-workflow-exec-id"
) -> CommandNode:
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
    workflow_execution_id = "test-exec-success"
    node = _make_node(
        command="echo {{#pre_node_id.number#}}",
        working_directory="dir-{{#pre_node_id.number#}}",
        workflow_execution_id=workflow_execution_id,
    )
    node.graph_runtime_state.variable_pool.add(("pre_node_id", "number"), 42)

    sandbox = FakeSandbox(stdout=b"ok\n", stderr=b"")
    SandboxManager.register(workflow_execution_id, sandbox)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["stdout"] == "ok\n"
    assert result.outputs["stderr"] == ""
    assert result.outputs["exit_code"] == 0

    assert sandbox.last_execute_command is not None
    assert sandbox.last_execute_command[:2] == ["sh", "-c"]
    assert "cd dir-42 && echo 42" in sandbox.last_execute_command[2]


def test_command_node_nonzero_exit_code_returns_failed_result():
    workflow_execution_id = "test-exec-nonzero"
    node = _make_node(command="false", workflow_execution_id=workflow_execution_id)
    sandbox = FakeSandbox(
        stdout=b"out",
        stderr=b"err",
        statuses=[CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=2)],
    )
    SandboxManager.register(workflow_execution_id, sandbox)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.outputs["exit_code"] == 2
    assert "exited with code" in result.error


def test_command_node_timeout_returns_failed_result_and_closes_transports(monkeypatch: Any):
    from core.workflow.nodes.command import node as command_node_module

    monkeypatch.setattr(command_node_module, "COMMAND_NODE_TIMEOUT_SECONDS", 1)

    workflow_execution_id = "test-exec-timeout"
    node = _make_node(command="sleep 10", workflow_execution_id=workflow_execution_id)
    sandbox = FakeSandbox(
        stdout=b"",
        stderr=b"",
        statuses=[CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)] * 1000,
        close_streams=False,
    )
    SandboxManager.register(workflow_execution_id, sandbox)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "CommandTimeoutError"
    assert "timed out" in result.error


def test_command_node_no_sandbox_returns_failed():
    workflow_execution_id = "test-exec-no-sandbox"
    node = _make_node(command="echo hello", workflow_execution_id=workflow_execution_id)

    result = node._run()  # pyright: ignore[reportPrivateUsage]

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "SandboxNotInitializedError"
    assert "Sandbox not available" in result.error
