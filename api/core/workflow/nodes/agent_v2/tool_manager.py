"""Tool management for Agent V2 Node.

Handles tool instance preparation, conversion to LLM-consumable format,
and creation of workflow-compatible tool invoke hooks.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Generator
from typing import TYPE_CHECKING, Any

from graphon.file import File
from graphon.model_runtime.entities import PromptMessageTool

from core.agent.entities import AgentToolEntity, ExecutionContext
from core.agent.patterns.base import ToolInvokeHook
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMeta, ToolInvokeMessage
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager

if TYPE_CHECKING:
    from .entities import ToolMetadata

logger = logging.getLogger(__name__)


class AgentV2ToolManager:
    """Manages tool lifecycle for Agent V2 node execution."""

    def __init__(
        self,
        *,
        tenant_id: str,
        app_id: str,
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id

    def prepare_tool_instances(
        self,
        tools_config: list[ToolMetadata],
    ) -> list[Tool]:
        """Convert tool metadata configs into runtime Tool instances."""
        tool_instances: list[Tool] = []
        for tool_meta in tools_config:
            if not tool_meta.enabled:
                continue
            try:
                processed_settings = {}
                for key, value in tool_meta.settings.items():
                    if isinstance(value, dict) and "value" in value and isinstance(value["value"], dict):
                        if "type" in value["value"] and "value" in value["value"]:
                            processed_settings[key] = value["value"]
                        else:
                            processed_settings[key] = value
                    else:
                        processed_settings[key] = value

                merged_parameters = {**tool_meta.parameters, **processed_settings}

                agent_tool = AgentToolEntity(
                    provider_id=tool_meta.provider_name,
                    provider_type=tool_meta.type,
                    tool_name=tool_meta.tool_name,
                    tool_parameters=merged_parameters,
                    plugin_unique_identifier=tool_meta.plugin_unique_identifier,
                    credential_id=tool_meta.credential_id,
                )

                tool_runtime = ToolManager.get_agent_tool_runtime(
                    tenant_id=self._tenant_id,
                    app_id=self._app_id,
                    agent_tool=agent_tool,
                )
                tool_instances.append(tool_runtime)
            except Exception:
                logger.warning("Failed to prepare tool %s/%s, skipping", tool_meta.provider_name, tool_meta.tool_name, exc_info=True)
                continue

        return tool_instances

    def create_workflow_tool_invoke_hook(
        self,
        context: ExecutionContext,
        workflow_call_depth: int = 0,
        sandbox: Any | None = None,
    ) -> ToolInvokeHook:
        """Create a ToolInvokeHook for workflow context.

        When sandbox is provided, tools that support sandbox execution will run
        inside the sandbox environment. Otherwise, falls back to generic_invoke.
        """

        def hook(
            tool: Tool,
            tool_args: dict[str, Any],
            tool_name: str,
        ) -> tuple[str, list[str], ToolInvokeMeta]:
            if sandbox is not None:
                return AgentV2ToolManager._invoke_tool_in_sandbox(sandbox, tool, tool_args, tool_name, context)

            return AgentV2ToolManager._invoke_tool_directly(tool, tool_args, tool_name, context, workflow_call_depth)

        return hook

    @staticmethod
    def _invoke_tool_directly(
        tool: Tool,
        tool_args: dict[str, Any],
        tool_name: str,
        context: ExecutionContext,
        workflow_call_depth: int,
    ) -> tuple[str, list[str], ToolInvokeMeta]:
        """Invoke tool directly via ToolEngine (no sandbox)."""
        tool_response = ToolEngine.generic_invoke(
            tool=tool,
            tool_parameters=tool_args,
            user_id=context.user_id or "",
            workflow_tool_callback=DifyWorkflowCallbackHandler(),
            workflow_call_depth=workflow_call_depth,
            app_id=context.app_id,
            conversation_id=context.conversation_id,
        )

        response_content = ""
        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                assert isinstance(response.message, ToolInvokeMessage.TextMessage)
                response_content += response.message.text
            elif response.type == ToolInvokeMessage.MessageType.JSON:
                if isinstance(response.message, ToolInvokeMessage.JsonMessage):
                    response_content += json.dumps(response.message.json_object, ensure_ascii=False)
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                if isinstance(response.message, ToolInvokeMessage.TextMessage):
                    response_content += f"[Link: {response.message.text}]"

        return response_content, [], ToolInvokeMeta.empty()

    @staticmethod
    def _invoke_tool_in_sandbox(
        sandbox: Any,
        tool: Tool,
        tool_args: dict[str, Any],
        tool_name: str,
        context: ExecutionContext,
    ) -> tuple[str, list[str], ToolInvokeMeta]:
        """Invoke tool inside a sandbox environment.

        Uses SandboxBashSession to run a `dify invoke-tool` command inside
        the sandbox VM, which calls back to Dify's CLI API for actual execution.
        Falls back to direct invocation on any failure.
        """
        try:
            from core.sandbox.bash.dify_cli import DifyCliLocator
            from core.sandbox.bash.session import SandboxBashSession
            from core.skill.entities.skill_metadata import ToolReference
            from core.skill.entities.tool_dependencies import ToolDependencies
            from core.tools.entities.tool_entities import ToolProviderType

            logger.info("[SANDBOX_TOOL] Entering sandbox tool path for %s, ready=%s", tool_name, sandbox._ready_event.is_set())
            if not sandbox._ready_event.is_set():
                logger.info("[SANDBOX_TOOL] Not ready, falling back to direct execution")
                return AgentV2ToolManager._invoke_tool_directly(tool, tool_args, tool_name, context, 0)

            cli_locator = DifyCliLocator()
            logger.info("[SANDBOX_TOOL] Resolving CLI binary...")
            cli_locator.resolve(sandbox.vm.metadata.os, sandbox.vm.metadata.arch)
            logger.info("[SANDBOX_TOOL] CLI binary found, creating bash session...")

            provider_type = tool.tool_provider_type() if hasattr(tool, 'tool_provider_type') else ToolProviderType.BUILT_IN
            tool_identity = getattr(tool, 'identity', None)
            provider_name = tool_identity.provider if tool_identity else tool_name

            tool_ref = ToolReference(
                type=provider_type,
                provider=provider_name,
                tool_name=tool_name,
            )
            tool_deps = ToolDependencies(references=[tool_ref])

            try:
                import gevent
                from gevent import Timeout as GTimeout
                timeout_ctx = GTimeout(15)
            except ImportError:
                from contextlib import nullcontext
                timeout_ctx = nullcontext()

            try:
                timeout_ctx.start() if hasattr(timeout_ctx, 'start') else None
                with SandboxBashSession(
                    sandbox=sandbox,
                    node_id=context.node_id or "agent",
                    tools=tool_deps,
                ) as session:
                    flag_args = " ".join(f"--{k} {json.dumps(v)}" for k, v in tool_args.items())
                    cmd = f"dify execute {tool_name} {flag_args}"
                    logger.info("[SANDBOX_TOOL] Executing: %s", cmd)
                    result = list(session.bash_tool.invoke(
                        user_id=context.user_id or "",
                        tool_parameters={"bash": cmd},
                    ))
                    response_text = ""
                    for msg in result:
                        if msg.type == ToolInvokeMessage.MessageType.TEXT:
                            assert isinstance(msg.message, ToolInvokeMessage.TextMessage)
                            response_text += msg.message.text
                    logger.info("[SANDBOX_TOOL] Success: %s", response_text[:80])
                    return response_text, [], ToolInvokeMeta.empty()
            except Exception as te:
                logger.warning("[SANDBOX_TOOL] Sandbox bash session failed/timed out for %s: %s, falling back", tool_name, te)
                return AgentV2ToolManager._invoke_tool_directly(tool, tool_args, tool_name, context, 0)
            finally:
                if hasattr(timeout_ctx, 'cancel'):
                    timeout_ctx.cancel()
        except FileNotFoundError:
            logger.info("DifyCli binary not found, falling back to direct tool invocation for %s", tool_name)
            return AgentV2ToolManager._invoke_tool_directly(
                tool, tool_args, tool_name, context, 0
            )
        except Exception as e:
            logger.warning("Sandbox tool invocation failed for %s, falling back to direct: %s", tool_name, e)
            return AgentV2ToolManager._invoke_tool_directly(
                tool, tool_args, tool_name, context, 0
            )
