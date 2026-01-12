import contextlib
import logging
import shlex
from collections.abc import Mapping, Sequence
from typing import Any

from core.sandbox.manager import SandboxManager
from core.virtual_environment.__base.command_future import CommandCancelledError, CommandTimeoutError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base import variable_template_parser
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.nodes.command.entities import CommandNodeData
from core.workflow.nodes.command.exc import CommandExecutionError

logger = logging.getLogger(__name__)

COMMAND_NODE_TIMEOUT_SECONDS = 60


class CommandNode(Node[CommandNodeData]):
    node_type = NodeType.COMMAND

    def _get_sandbox(self) -> VirtualEnvironment | None:
        workflow_execution_id = self.graph_runtime_state.variable_pool.system_variables.workflow_execution_id
        if not workflow_execution_id:
            return None
        return SandboxManager.get(workflow_execution_id)

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

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
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
        sandbox = self._get_sandbox()
        if sandbox is None:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="Sandbox not available for CommandNode.",
                error_type="SandboxNotInitializedError",
            )

        working_directory = self._render_template((self.node_data.working_directory or "").strip())
        raw_command = self._render_template(self.node_data.command or "")

        working_directory = working_directory or None

        if not raw_command:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="Command is required.",
                error_type="CommandNodeError",
            )

        timeout = COMMAND_NODE_TIMEOUT_SECONDS if COMMAND_NODE_TIMEOUT_SECONDS > 0 else None
        connection_handle = sandbox.establish_connection()

        try:
            command = shlex.split(raw_command)
            future = sandbox.run_command(connection_handle, command, cwd=working_directory)
            result = future.result(timeout=timeout)

            outputs: dict[str, Any] = {
                "stdout": result.stdout.decode("utf-8", errors="replace"),
                "stderr": result.stderr.decode("utf-8", errors="replace"),
                "exit_code": result.exit_code,
                "pid": result.pid,
            }
            process_data = {"command": command, "working_directory": working_directory}

            if result.exit_code not in (None, 0):
                error_message = (
                    f"{result.stderr.decode('utf-8', errors='replace')}\n\nCommand exited with code {result.exit_code}"
                )
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    outputs=outputs,
                    process_data=process_data,
                    error=error_message,
                    error_type=CommandExecutionError.__name__,
                )

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs=outputs,
                process_data=process_data,
            )

        except CommandTimeoutError:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Command timed out after {COMMAND_NODE_TIMEOUT_SECONDS}s",
                error_type=CommandTimeoutError.__name__,
            )
        except CommandCancelledError:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="Command was cancelled",
                error_type=CommandCancelledError.__name__,
            )
        except Exception as e:
            logger.exception("Command node %s failed", self.id)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type=type(e).__name__,
            )
        finally:
            with contextlib.suppress(Exception):
                sandbox.release_connection(connection_handle)

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config

        typed_node_data = CommandNodeData.model_validate(node_data)

        selectors: list[VariableSelector] = []
        selectors += list(variable_template_parser.extract_selectors_from_template(typed_node_data.command))
        selectors += list(variable_template_parser.extract_selectors_from_template(typed_node_data.working_directory))

        mapping: dict[str, Sequence[str]] = {}
        for selector in selectors:
            mapping[node_id + "." + selector.variable] = selector.value_selector

        return mapping
