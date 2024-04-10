import json
from typing import Literal
from core.agent.cot_agent_runner import CotAgentRunner
from core.agent.entities import AgentPromptEntity, AgentScratchpadUnit
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool


class CotCompletionAgentRunner(CotAgentRunner):
    def _format_instructions(self, instruction: str, tools: list[PromptMessageTool],
                                prompt_template: AgentPromptEntity
        ) -> str:
        """
        format instructions
        """
        result = prompt_template.first_prompt

        # format tools
        result = result.replace('{{tools}}', json.dumps(tools))

        result = result.replace('{{tool_names}}', ', '.join([tool.name for tool in tools]))

        # format instruction
        result = result.replace('{{instruction}}', instruction)

        return result

    def _format_scratchpads(self, scratchpad: list[AgentScratchpadUnit],
        ) -> str:
        """
            format scratchpads
        """
        result = ""

        for unit in scratchpad:
            if unit.is_final():
                result += f"Final Answer: {unit.agent_response}"
            else:
                result += f"Thought: {unit.thought}\n\n"
                if unit.action_str:
                    result += f"Action: {unit.action_str}\n\n"
                if unit.observation:
                    result += f"Observation: {unit.observation}\n\n"

        return result
    
    def _organize_historic_prompt_messages(self, mode: Literal["completion", "chat"],
                                           prompt_messages: list[PromptMessage],
                                           tools: list[PromptMessageTool],
                                           agent_prompt_message: AgentPromptEntity,
                                           instruction: str,
        ) -> list[PromptMessage]:
        """
            organize historic prompt messages
        """
        result = []


    def _organize_current_prompt_messages(self, mode: Literal["completion", "chat"],
                                      prompt_messages: list[PromptMessage],
                                      tools: list[PromptMessageTool], 
                                      agent_prompt_message: AgentPromptEntity,
                                      instruction: str,
                                      input: str,
        ) -> list[PromptMessage]:
        """
            organize current prompt messages
        """
