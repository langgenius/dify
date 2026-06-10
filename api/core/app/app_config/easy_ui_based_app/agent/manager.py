from typing import Any, cast

from core.agent.entities import AgentEntity, AgentPromptEntity, AgentToolEntity
from core.agent.prompt.template import REACT_PROMPT_TEMPLATES
from models.model import AppModelConfigDict


class AgentConfigManager:
    @classmethod
    def convert(cls, config: AppModelConfigDict) -> AgentEntity | None:
        """
        Convert model config to model config

        :param config: model config args
        """
        if "agent_mode" in config and config["agent_mode"] and "enabled" in config["agent_mode"]:
            agent_dict = config.get("agent_mode", {})
            agent_strategy = agent_dict.get("strategy", "cot")

            match agent_strategy:
                case "function_call":
                    strategy = AgentEntity.Strategy.FUNCTION_CALLING
                case "cot" | "react":
                    strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT
                case _:
                    # old configs, try to detect default strategy
                    if config["model"]["provider"] == "openai":
                        strategy = AgentEntity.Strategy.FUNCTION_CALLING
                    else:
                        strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT

            agent_tools = []
            for tool in agent_dict.get("tools", []):
                tool_dict = cast(dict[str, Any], tool)
                if len(tool_dict) >= 4:
                    if "enabled" not in tool_dict or not tool_dict["enabled"]:
                        continue

                    agent_tool_properties = {
                        "provider_type": tool_dict["provider_type"],
                        "provider_id": tool_dict["provider_id"],
                        "tool_name": tool_dict["tool_name"],
                        "tool_parameters": tool_dict.get("tool_parameters", {}),
                        "credential_id": tool_dict.get("credential_id", None),
                    }

                    agent_tools.append(AgentToolEntity.model_validate(agent_tool_properties))

            if "strategy" in config["agent_mode"] and config["agent_mode"]["strategy"] not in {
                "react_router",
                "router",
            }:
                agent_prompt_raw = agent_dict.get("prompt", None)
                agent_prompt: dict[str, Any] = agent_prompt_raw if isinstance(agent_prompt_raw, dict) else {}
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
                    max_iteration=cast(int, agent_dict.get("max_iteration", 10)),
                )

        return None
