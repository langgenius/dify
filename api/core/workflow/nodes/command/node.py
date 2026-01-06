import contextlib
import logging
import shlex
import threading
import time
from collections.abc import Mapping, Sequence
from typing import Any

from core.virtual_environment.__base.exec import NotSupportedOperationError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import TransportReadCloser
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base import variable_template_parser
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.nodes.command.entities import CommandNodeData
from core.workflow.nodes.command.exc import CommandExecutionError, CommandTimeoutError

logger = logging.getLogger(__name__)

COMMAND_NODE_TIMEOUT_SECONDS = 60


def _drain_transport(transport: TransportReadCloser, buffer: bytearray) -> None:
    try:
        while True:
            buffer.extend(transport.read(4096))
    except TransportEOFError:
        pass
    except Exception:
        logger.exception("Failed reading transport")
    finally:
        with contextlib.suppress(Exception):
            transport.close()


class CommandNode(Node[CommandNodeData]):
    """Command Node - execute shell commands in a VirtualEnvironment."""

    # FIXME: This is a temporary solution for sandbox injection from SandboxLayer.
    # The sandbox is dynamically attached by SandboxLayer.on_node_run_start() before
    # node execution and cleared by on_node_run_end(). A cleaner approach would be
    # to pass sandbox through GraphRuntimeState or use a proper dependency injection pattern.
    sandbox: VirtualEnvironment | None = None

    def _render_template(self, template: str) -> str:
        parser = VariableTemplateParser(template=template)
        selectors = parser.extract_variable_selectors()
        if not selectors:
            return template

        inputs: dict[str, Any] = {}
        for selector in selectors:
            value = self.graph_runtime_state.variable_pool.get(selector.value_selector)
            inputs[selector.variable] = value.to_object() if value is not None else None

        return parser.format(inputs)

    node_type = NodeType.COMMAND

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        """Get default config of node."""
        return {
            "type": "command",
            "config": {
                "working_directory": "",
                "command": "",
            },
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        if not isinstance(self.sandbox, VirtualEnvironment):
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="Sandbox not available for CommandNode.",
                error_type="SandboxNotInitializedError",
            )

        working_directory = (self.node_data.working_directory or "").strip()
        raw_command = (self.node_data.command or "").strip()

        working_directory = self._render_template(working_directory).strip()
        raw_command = self._render_template(raw_command).strip()

        working_directory = working_directory or None
        timeout_seconds = COMMAND_NODE_TIMEOUT_SECONDS

        if not raw_command:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="Command is required.",
                error_type="CommandNodeError",
            )

        shell_command = raw_command
        if working_directory:
            shell_command = f"cd {shlex.quote(working_directory)} && {raw_command}"

        command = ["sh", "-lc", shell_command]

        # 0 or negative means no timeout
        deadline = None
        if timeout_seconds > 0:
            deadline = time.monotonic() + timeout_seconds

        connection_handle = self.sandbox.establish_connection()

        pid = ""
        stdin_transport = None
        stdout_transport = None
        stderr_transport = None
        threads: list[threading.Thread] = []
        stdout_buf = bytearray()
        stderr_buf = bytearray()

        try:
            pid, stdin_transport, stdout_transport, stderr_transport = self.sandbox.execute_command(
                connection_handle, command
            )

            # This node currently does not support interactive stdin.
            with contextlib.suppress(Exception):
                stdin_transport.close()

            is_combined_stream = stdout_transport is stderr_transport

            stdout_thread = threading.Thread(
                target=_drain_transport,
                args=(stdout_transport, stdout_buf),
                daemon=True,
            )
            threads.append(stdout_thread)
            stdout_thread.start()

            if not is_combined_stream:
                stderr_thread = threading.Thread(
                    target=_drain_transport,
                    args=(stderr_transport, stderr_buf),
                    daemon=True,
                )
                threads.append(stderr_thread)
                stderr_thread.start()

            exit_code: int | None = None

            while True:
                if deadline is not None and time.monotonic() > deadline:
                    raise CommandTimeoutError(f"Command timed out after {timeout_seconds}s")

                try:
                    status = self.sandbox.get_command_status(connection_handle, pid)
                except NotSupportedOperationError:
                    break

                if status.status == status.Status.COMPLETED:
                    exit_code = status.exit_code
                    break

                time.sleep(0.1)

            # Ensure transports are fully drained.
            def _join_all() -> bool:
                for t in threads:
                    remaining = None
                    if deadline is not None:
                        remaining = max(0.0, deadline - time.monotonic())
                    t.join(timeout=remaining)
                    if t.is_alive():
                        return False
                return True

            if not _join_all():
                raise CommandTimeoutError(f"Command output not drained within {timeout_seconds}s")

            stdout_text = stdout_buf.decode("utf-8", errors="replace")
            stderr_text = "" if is_combined_stream else stderr_buf.decode("utf-8", errors="replace")

            outputs: dict[str, Any] = {
                "stdout": stdout_text,
                "stderr": stderr_text,
                "exit_code": exit_code,
                "pid": pid,
            }

            if exit_code not in (None, 0):
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    outputs=outputs,
                    process_data={"command": command, "working_directory": working_directory},
                    error=f"Command exited with code {exit_code}",
                    error_type=CommandExecutionError.__name__,
                )

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs=outputs,
                process_data={"command": command, "working_directory": working_directory},
            )

        except (CommandExecutionError, CommandTimeoutError) as e:
            if isinstance(e, CommandTimeoutError) and stdout_transport is not None:
                for transport in (stdout_transport, stderr_transport):
                    if transport is None:
                        continue
                    with contextlib.suppress(Exception):
                        transport.close()

            for t in threads:
                t.join(timeout=0.2)

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                outputs={
                    "stdout": stdout_buf.decode("utf-8", errors="replace"),
                    "stderr": stderr_buf.decode("utf-8", errors="replace"),
                    "exit_code": None,
                    "pid": pid,
                },
                process_data={"command": command, "working_directory": working_directory},
                error=str(e),
                error_type=type(e).__name__,
            )
        except Exception as e:
            logger.exception("Command node %s failed", self.id)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                outputs={
                    "stdout": stdout_buf.decode("utf-8", errors="replace"),
                    "stderr": stderr_buf.decode("utf-8", errors="replace"),
                    "exit_code": None,
                    "pid": pid,
                },
                process_data={"command": command, "working_directory": working_directory},
                error=str(e),
                error_type=type(e).__name__,
            )
        finally:
            with contextlib.suppress(Exception):
                self.sandbox.release_connection(connection_handle)

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """Extract variable mappings from node data."""
        _ = graph_config  # Explicitly mark as unused

        typed_node_data = CommandNodeData.model_validate(node_data)

        selectors: list[VariableSelector] = []
        selectors += list(variable_template_parser.extract_selectors_from_template(typed_node_data.command))
        selectors += list(variable_template_parser.extract_selectors_from_template(typed_node_data.working_directory))

        mapping: dict[str, Sequence[str]] = {}
        for selector in selectors:
            mapping[node_id + "." + selector.variable] = selector.value_selector

        return mapping
