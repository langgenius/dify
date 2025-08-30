from typing import Optional

from core.agent.entities import AgentEntity, AgentPromptEntity, AgentToolEntity
from core.agent.prompt.template import REACT_PROMPT_TEMPLATES


class AgentConfigManager:
    @classmethod
    def convert(cls, config: dict) -> Optional[AgentEntity]:
        """
        Convert model config to model config

        :param config: model config args
        """
        if "agent_mode" in config and config["agent_mode"] and "enabled" in config["agent_mode"]:
            agent_dict = config.get("agent_mode", {})
            agent_strategy = agent_dict.get("strategy", "cot")

            if agent_strategy == "function_call":
                strategy = AgentEntity.Strategy.FUNCTION_CALLING
            elif agent_strategy in {"cot", "react"}:
                strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT
            else:
                # old configs, try to detect default strategy
                if config["model"]["provider"] == "openai":
                    strategy = AgentEntity.Strategy.FUNCTION_CALLING
                else:
                    strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT

            agent_tools = []
            for tool in agent_dict.get("tools", []):
                keys = tool.keys()
                if len(keys) >= 4:
                    if "enabled" not in tool or not tool["enabled"]:
                        continue

                    agent_tool_properties = {
                        "provider_type": tool["provider_type"],
                        "provider_id": tool["provider_id"],
                        "tool_name": tool["tool_name"],
                        "tool_parameters": tool.get("tool_parameters", {}),
                        "credential_id": tool.get("credential_id", None),
                    }

                    agent_tools.append(AgentToolEntity(**agent_tool_properties))

            if "strategy" in config["agent_mode"] and config["agent_mode"]["strategy"] not in {
                "react_router",
                "router",
            }:
                agent_prompt = agent_dict.get("prompt", None) or {}
                # check model mode
                model_mode = config.get("model", {}).get("mode", "completion")
                if model_mode == "completion":
                    agent_prompt_entity = AgentPromptEntity(
                        first_prompt=agent_prompt.get(
                            "first_prompt", REACT_PROMPT_TEMPLATES["english"]["completion"]["prompt"]
                        ),
                        next_iteration=agent_prompt.get(
                            "next_iteration", REACT_PROMPT_TEMPLATES["english"]["completion"]["agent_scratchpad"]
                        ),
                    )
                else:
                    agent_prompt_entity = AgentPromptEntity(
                        first_prompt=agent_prompt.get(
                            "first_prompt", REACT_PROMPT_TEMPLATES["english"]["chat"]["prompt"]
                        ),
                        next_iteration=agent_prompt.get(
                            "next_iteration", REACT_PROMPT_TEMPLATES["english"]["chat"]["agent_scratchpad"]
                        ),
                    )

                return AgentEntity(
                    provider=config["model"]["provider"],
                    model=config["model"]["name"],
                    strategy=strategy,
                    prompt=agent_prompt_entity,
                    tools=agent_tools,
                    max_iteration=agent_dict.get("max_iteration", 10),
                )

        return None
