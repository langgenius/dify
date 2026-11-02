"""Present one Agent message log after its read transaction has closed."""

from datetime import UTC
from typing import Any

import pytz

from core.app.app_config.easy_ui_based_app.agent.manager import AgentConfigManager
from core.tools.entities.tool_entities import EmojiIconDict
from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.agent.log_contracts import AgentLogConfigurationError, AgentLogFiles, AgentLogIcons, AgentLogRecords


class AgentLogService:
    def __init__(self, *, records: AgentLogRecords, icons: AgentLogIcons, files: AgentLogFiles) -> None:
        self._records = records
        self._icons = icons
        self._files = files

    def get(self, context: RequestContext, *, app_id: str, conversation_id: str, message_id: str) -> dict[str, Any]:
        log = self._records.agent_log(
            tenant_id=context.active_workspace_id,
            account_id=context.account_id,
            app_id=app_id,
            conversation_id=conversation_id,
            message_id=message_id,
        )
        agent_config = AgentConfigManager.convert(log.model_config)
        if agent_config is None:
            raise AgentLogConfigurationError("Agent config not found")
        configured_tools = {tool.tool_name: tool for tool in agent_config.tools or []}
        iterations = []
        for thought in log.thoughts:
            tool_calls = []
            for name in thought.tools:
                metadata = thought.metadata.get(name, {})
                config = metadata.get("tool_config", {})
                provider_type = config.get("tool_provider_type", "")
                provider_id = config.get("tool_provider", "")
                configured = configured_tools.get(name)
                if not provider_type and configured is not None:
                    provider_type = configured.provider_type
                    provider_id = provider_id or configured.provider_id
                icon: str | EmojiIconDict = ""
                if provider_type and provider_type != "dataset-retrieval":
                    icon = self._icons(
                        tenant_id=context.active_workspace_id,
                        provider_type=provider_type,
                        provider_id=provider_id,
                    )
                    if not icon and configured is not None:
                        icon = self._icons(
                            tenant_id=context.active_workspace_id,
                            provider_type=configured.provider_type,
                            provider_id=configured.provider_id,
                        )
                tool_calls.append(
                    {
                        "status": "success" if not metadata.get("error") else "error",
                        "error": metadata.get("error"),
                        "time_cost": metadata.get("time_cost", 0),
                        "tool_name": name,
                        "tool_label": thought.labels.get(name, name),
                        "tool_input": thought.inputs.get(name, {}),
                        "tool_output": thought.outputs.get(name, {}),
                        "tool_parameters": metadata.get("tool_parameters", {}),
                        "tool_icon": icon,
                    }
                )
            iterations.append(
                {
                    "tokens": thought.tokens or 0,
                    "tool_calls": tool_calls,
                    "tool_raw": {"inputs": thought.raw_input, "outputs": thought.raw_output},
                    "thought": thought.thought,
                    "created_at": thought.created_at.isoformat(),
                    "files": thought.files,
                }
            )
        return {
            "meta": {
                "status": "success",
                "executor": log.executor,
                "start_time": ensure_naive_utc(log.created_at)
                .replace(tzinfo=UTC)
                .astimezone(pytz.timezone(log.timezone))
                .isoformat(),
                "elapsed_time": log.elapsed_time,
                "total_tokens": log.total_tokens,
                "agent_mode": log.model_config["agent_mode"].get("strategy", "react"),
                "iterations": len(iterations),
            },
            "iterations": iterations,
            "files": self._files.resolve(tenant_id=context.active_workspace_id, files=log.files),
        }
