from collections.abc import Generator
from typing import Any

from core.sandbox.constants import DIFY_CLI_CONFIG_FILENAME
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

COMMAND_TIMEOUT_SECONDS = 60


class SandboxBashTool(Tool):
    def __init__(self, sandbox: VirtualEnvironment, tenant_id: str, tools_path: str | None = None) -> None:
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
                    name="command",
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
                "The command will be executed in the current working directory.",
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
        command = tool_parameters.get("command", "")
        if not command:
            yield self.create_text_message("Error: No command provided")
            return

        try:
            with with_connection(self._sandbox) as conn:
                cmd_list = ["bash", "-c", command]

                sandbox_debug("bash_tool", "cmd_list", cmd_list)
                environments: dict[str, str] | None = None
                if self._tools_path:
                    environments = {
                        "PATH": f"{self._tools_path}:/usr/local/bin:/usr/bin:/bin",
                        "DIFY_CLI_CONFIG": self._tools_path + f"/{DIFY_CLI_CONFIG_FILENAME}",
                    }
                future = submit_command(
                    self._sandbox,
                    conn,
                    cmd_list,
                    environments=environments,
                )
                timeout = COMMAND_TIMEOUT_SECONDS if COMMAND_TIMEOUT_SECONDS > 0 else None
                result = future.result(timeout=timeout)

                stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
                stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
                exit_code = result.exit_code

                output_parts: list[str] = []
                if stdout:
                    output_parts.append(f"\n{stdout}")
                if stderr:
                    output_parts.append(f"\n{stderr}")
                output_parts.append(f"\nCommand exited with code {exit_code}")

                yield self.create_text_message("\n".join(output_parts))

        except TimeoutError:
            yield self.create_text_message(f"Error: Command timed out after {COMMAND_TIMEOUT_SECONDS}s")
        except Exception as e:
            yield self.create_text_message(f"Error: {e!s}")
