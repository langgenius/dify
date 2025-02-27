import threading
from typing import Optional

import pytz
from flask_login import current_user  # type: ignore

import contexts
from core.app.app_config.easy_ui_based_app.agent.manager import AgentConfigManager
from core.plugin.manager.agent import PluginAgentManager
from core.plugin.manager.exc import PluginDaemonClientSideError
from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from models.account import Account
from models.model import App, Conversation, EndUser, Message, MessageAgentThought


class AgentService:
    @classmethod
    def get_agent_logs(cls, app_model: App, conversation_id: str, message_id: str) -> dict:
        """
        Service to get agent logs
        """
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        conversation: Conversation | None = (
            db.session.query(Conversation)
            .filter(
                Conversation.id == conversation_id,
                Conversation.app_id == app_model.id,
            )
            .first()
        )

        if not conversation:
            raise ValueError(f"Conversation not found: {conversation_id}")

        message: Optional[Message] = (
            db.session.query(Message)
            .filter(
                Message.id == message_id,
                Message.conversation_id == conversation_id,
            )
            .first()
        )

        if not message:
            raise ValueError(f"Message not found: {message_id}")

        agent_thoughts: list[MessageAgentThought] = message.agent_thoughts

        if conversation.from_end_user_id:
            # only select name field
            executor = (
                db.session.query(EndUser, EndUser.name).filter(EndUser.id == conversation.from_end_user_id).first()
            )
        else:
            executor = (
                db.session.query(Account, Account.name).filter(Account.id == conversation.from_account_id).first()
            )

        if executor:
            executor = executor.name
        else:
            executor = "Unknown"

        timezone = pytz.timezone(current_user.timezone)

        app_model_config = app_model.app_model_config
        if not app_model_config:
            raise ValueError("App model config not found")

        result = {
            "meta": {
                "status": "success",
                "executor": executor,
                "start_time": message.created_at.astimezone(timezone).isoformat(),
                "elapsed_time": message.provider_response_latency,
                "total_tokens": message.answer_tokens + message.message_tokens,
                "agent_mode": app_model_config.agent_mode_dict.get("strategy", "react"),
                "iterations": len(agent_thoughts),
            },
            "iterations": [],
            "files": message.message_files,
        }

        agent_config = AgentConfigManager.convert(app_model_config.to_dict())
        if not agent_config:
            raise ValueError("Agent config not found")

        agent_tools = agent_config.tools or []

        def find_agent_tool(tool_name: str):
            for agent_tool in agent_tools:
                if agent_tool.tool_name == tool_name:
                    return agent_tool

        for agent_thought in agent_thoughts:
            tools = agent_thought.tools
            tool_labels = agent_thought.tool_labels
            tool_meta = agent_thought.tool_meta
            tool_inputs = agent_thought.tool_inputs_dict
            tool_outputs = agent_thought.tool_outputs_dict or {}
            tool_calls = []
            for tool in tools:
                tool_name = tool
                tool_label = tool_labels.get(tool_name, tool_name)
                tool_input = tool_inputs.get(tool_name, {})
                tool_output = tool_outputs.get(tool_name, {})
                tool_meta_data = tool_meta.get(tool_name, {})
                tool_config = tool_meta_data.get("tool_config", {})
                if tool_config.get("tool_provider_type", "") != "dataset-retrieval":
                    tool_icon = ToolManager.get_tool_icon(
                        tenant_id=app_model.tenant_id,
                        provider_type=tool_config.get("tool_provider_type", ""),
                        provider_id=tool_config.get("tool_provider", ""),
                    )
                    if not tool_icon:
                        tool_entity = find_agent_tool(tool_name)
                        if tool_entity:
                            tool_icon = ToolManager.get_tool_icon(
                                tenant_id=app_model.tenant_id,
                                provider_type=tool_entity.provider_type,
                                provider_id=tool_entity.provider_id,
                            )
                else:
                    tool_icon = ""

                tool_calls.append(
                    {
                        "status": "success" if not tool_meta_data.get("error") else "error",
                        "error": tool_meta_data.get("error"),
                        "time_cost": tool_meta_data.get("time_cost", 0),
                        "tool_name": tool_name,
                        "tool_label": tool_label,
                        "tool_input": tool_input,
                        "tool_output": tool_output,
                        "tool_parameters": tool_meta_data.get("tool_parameters", {}),
                        "tool_icon": tool_icon,
                    }
                )

            result["iterations"].append(
                {
                    "tokens": agent_thought.tokens,
                    "tool_calls": tool_calls,
                    "tool_raw": {
                        "inputs": agent_thought.tool_input,
                        "outputs": agent_thought.observation,
                    },
                    "thought": agent_thought.thought,
                    "created_at": agent_thought.created_at.isoformat(),
                    "files": agent_thought.files,
                }
            )

        return result

    @classmethod
    def list_agent_providers(cls, user_id: str, tenant_id: str):
        """
        List agent providers
        """
        manager = PluginAgentManager()
        return manager.fetch_agent_strategy_providers(tenant_id)

    @classmethod
    def get_agent_provider(cls, user_id: str, tenant_id: str, provider_name: str):
        """
        Get agent provider
        """
        manager = PluginAgentManager()
        try:
            return manager.fetch_agent_strategy_provider(tenant_id, provider_name)
        except PluginDaemonClientSideError as e:
            raise ValueError(str(e)) from e
