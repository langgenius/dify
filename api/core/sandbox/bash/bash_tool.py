from collections.abc import Generator
from typing import Any

from core.sandbox.entities import DifyCli
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from core.virtual_environment.__base.helpers import submit_command, with_connection
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from ..utils.debug import sandbox_debug

COMMAND_TIMEOUT_SECONDS = 60 * 60 * 2  # 2 hours, can be adjusted based on expected command execution times

# Output truncation settings to avoid overwhelming model context
# 8000 chars ≈ 2000-2700 tokens, safe for models with 8K+ context
MAX_OUTPUT_LENGTH = 8000
TRUNCATE_HEAD_LENGTH = 2500  # Keep beginning for context
TRUNCATE_TAIL_LENGTH = 2500  # Keep end for results/errors


def _truncate_output(output: str, name: str = "output") -> str:
    """Truncate output if it exceeds the maximum length.

    Keeps the head and tail of the output to preserve context and final results.
    """
    if len(output) <= MAX_OUTPUT_LENGTH:
        return output

    omitted_length = len(output) - TRUNCATE_HEAD_LENGTH - TRUNCATE_TAIL_LENGTH
    head = output[:TRUNCATE_HEAD_LENGTH]
    tail = output[-TRUNCATE_TAIL_LENGTH:]

    return f"{head}\n\n... [{omitted_length} characters omitted from {name}] ...\n\n{tail}"


class SandboxBashTool(Tool):
    def __init__(self, sandbox: VirtualEnvironment, tenant_id: str, tools_path: str) -> None:
        self._sandbox = sandbox
        self._tools_path = tools_path

        entity = ToolEntity(
            identity=ToolIdentity(
                author="Dify",
                name="bash",
                label=I18nObject(en_US="Bash", zh_Hans="Bash"),
                provider="sandbox",
            ),
            parameters=[
                ToolParameter.get_simple_instance(
                    name="bash",
                    llm_description="The bash command to execute in current working directory",
                    typ=ToolParameter.ToolParameterType.STRING,
                    required=True,
                ),
            ],
            description=ToolDescription(
                human=I18nObject(
                    en_US="Execute bash commands in current working directory",
                ),
                llm="Execute bash commands in current working directory. "
                "Use this tool to run shell commands, scripts, or interact with the system. "
                "The command will be executed in the current working directory. "
                "IMPORTANT: If you generate any output files (images, documents, etc.) that need to be "
                "returned or referenced later, you MUST save them to the 'output/' directory "
                "(e.g., 'mkdir -p output && cp result.png output/'). Only files in output/ will be collected.",
            ),
        )

        runtime = ToolRuntime(tenant_id=tenant_id)
        super().__init__(entity=entity, runtime=runtime)

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        command = tool_parameters.get("bash", "")
        if not command:
            sandbox_debug("bash_tool", "parameters", tool_parameters)
            yield self.create_text_message(
                'Error: No command provided. The "bash" parameter is required and must contain '
                'the shell command to execute. Example: {"bash": "ls -la"}'
            )
            return

        try:
            with with_connection(self._sandbox) as conn:
                # Build command with embedded environment variables
                env_exports = (
                    f"export PATH={self._tools_path}:/usr/local/bin:/usr/bin:/bin && "
                    f"export DIFY_CLI_CONFIG={self._tools_path}/{DifyCli.CONFIG_FILENAME} && "
                )
                full_command = env_exports + command

                cmd_list = ["bash", "-c", full_command]
                sandbox_debug("bash_tool", "cmd_list", cmd_list)

                future = submit_command(
                    self._sandbox,
                    conn,
                    cmd_list,
                )
                timeout = COMMAND_TIMEOUT_SECONDS if COMMAND_TIMEOUT_SECONDS > 0 else None
                result = future.result(timeout=timeout)

                stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
                stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""

                # Truncate long outputs to avoid overwhelming the model
                stdout = _truncate_output(stdout, "stdout")
                stderr = _truncate_output(stderr, "stderr")

                output_parts: list[str] = []
                if stdout:
                    output_parts.append(f"\n{stdout}")
                if stderr:
                    output_parts.append(f"\n{stderr}")

                yield self.create_text_message("\n".join(output_parts))

        except TimeoutError:
            yield self.create_text_message(f"Error: Command timed out after {COMMAND_TIMEOUT_SECONDS}s")
        except Exception as e:
            yield self.create_text_message(f"Error: {e!s}")
