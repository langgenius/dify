import json

from core.agent.cot_agent_runner import CotAgentRunner
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.utils.encoders import jsonable_encoder


class CotChatAgentRunner(CotAgentRunner):
    def _organize_system_prompt(self) -> SystemPromptMessage:
        """
        Organize system prompt
        """
        prompt_entity = self.app_config.agent.prompt
        first_prompt = prompt_entity.first_prompt

        system_prompt = first_prompt \
            .replace("{{instruction}}", self._instruction) \
            .replace("{{tools}}", json.dumps(jsonable_encoder(self._prompt_messages_tools))) \
            .replace("{{tool_names}}", ', '.join([tool.name for tool in self._prompt_messages_tools]))

        return SystemPromptMessage(content=system_prompt)

    def _organize_prompt_messages(self) -> list[PromptMessage]:
        """
        Organize 
        """
        # organize system prompt
        system_message = self._organize_system_prompt()

        # organize historic prompt messages
        historic_messages = self._historic_prompt_messages

        # organize current assistant messages
        agent_scratchpad = self._agent_scratchpad
        if not agent_scratchpad:
            assistant_messages = []
        else:
            assistant_message = AssistantPromptMessage(content='')
            for unit in agent_scratchpad:
                if unit.is_final():
                    assistant_message.content += f"Final Answer: {unit.agent_response}"
                else:
                    assistant_message.content += f"Thought: {unit.thought}\n\n"
                    if unit.action_str:
                        assistant_message.content += f"Action: {unit.action_str}\n\n"
                    if unit.observation:
                        assistant_message.content += f"Observation: {unit.observation}\n\n"

            assistant_messages = [assistant_message]

        # query messages
        query_messages = UserPromptMessage(content=self._query)

        if assistant_messages:
            messages = [
                system_message,
                *historic_messages,
                query_messages,
                *assistant_messages,
                UserPromptMessage(content='continue')
            ]
        else:
            messages = [system_message, *historic_messages, query_messages]

        # join all messages
        return messages