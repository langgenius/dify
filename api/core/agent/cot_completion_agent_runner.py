import json

from core.agent.cot_agent_runner import CotAgentRunner
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from core.model_runtime.utils.encoders import jsonable_encoder


class CotCompletionAgentRunner(CotAgentRunner):
    def _organize_instruction_prompt(self) -> str:
        """
        Organize instruction prompt
        """
        prompt_entity = self.app_config.agent.prompt
        first_prompt = prompt_entity.first_prompt

        system_prompt = first_prompt.replace("{{instruction}}", self._instruction) \
            .replace("{{tools}}", json.dumps(jsonable_encoder(self._prompt_messages_tools))) \
            .replace("{{tool_names}}", ', '.join([tool.name for tool in self._prompt_messages_tools]))
        
        return system_prompt

    def _organize_historic_prompt(self, current_session_messages: list[PromptMessage] = None) -> str:
        """
        Organize historic prompt
        """
        historic_prompt_messages = self._organize_historic_prompt_messages(current_session_messages)
        historic_prompt = ""

        for message in historic_prompt_messages:
            if isinstance(message, UserPromptMessage):
                historic_prompt += f"Question: {message.content}\n\n"
            elif isinstance(message, AssistantPromptMessage):
                historic_prompt += message.content + "\n\n"

        return historic_prompt

    def _organize_prompt_messages(self) -> list[PromptMessage]:
        """
        Organize prompt messages
        """
        # organize system prompt
        system_prompt = self._organize_instruction_prompt()

        # organize historic prompt messages
        historic_prompt = self._organize_historic_prompt()

        # organize current assistant messages
        agent_scratchpad = self._agent_scratchpad
        assistant_prompt = ''
        for unit in agent_scratchpad:
            if unit.is_final():
                assistant_prompt += f"Final Answer: {unit.agent_response}"
            else:
                assistant_prompt += f"Thought: {unit.thought}\n\n"
                if unit.action_str:
                    assistant_prompt += f"Action: {unit.action_str}\n\n"
                if unit.observation:
                    assistant_prompt += f"Observation: {unit.observation}\n\n"

        # query messages
        query_prompt = f"Question: {self._query}"

        # join all messages
        prompt = system_prompt \
            .replace("{{historic_messages}}", historic_prompt) \
            .replace("{{agent_scratchpad}}", assistant_prompt) \
            .replace("{{query}}", query_prompt)

        return [UserPromptMessage(content=prompt)]