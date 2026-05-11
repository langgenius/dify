import json

from core.agent.cot_agent_runner import CotAgentRunner
from graphon.file import file_manager
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent, PromptMessageContentUnionTypes
from graphon.model_runtime.utils.encoders import jsonable_encoder


class CotChatAgentRunner(CotAgentRunner):
    def _organize_system_prompt(self) -> SystemPromptMessage:
        """
        Organize system prompt
        """
        assert self.app_config.agent
        assert self.app_config.agent.prompt

        prompt_entity = self.app_config.agent.prompt
        if not prompt_entity:
            raise ValueError("Agent prompt configuration is not set")
        first_prompt = prompt_entity.first_prompt

        system_prompt = (
            first_prompt.replace("{{instruction}}", self._instruction)
            .replace("{{tools}}", json.dumps(jsonable_encoder(self._prompt_messages_tools)))
            .replace("{{tool_names}}", ", ".join([tool.name for tool in self._prompt_messages_tools]))
        )

        return SystemPromptMessage(content=system_prompt)

    def _organize_user_query(self, query, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Organize user query
        """
        if self.files:
            # get image detail config
            image_detail_config = (
                self.application_generate_entity.file_upload_config.image_config.detail
                if (
                    self.application_generate_entity.file_upload_config
                    and self.application_generate_entity.file_upload_config.image_config
                )
                else None
            )
            image_detail_config = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

            prompt_message_contents: list[PromptMessageContentUnionTypes] = []
            for file in self.files:
                prompt_message_contents.append(
                    file_manager.to_prompt_message_content(
                        file,
                        image_detail_config=image_detail_config,
                    )
                )
            prompt_message_contents.append(TextPromptMessageContent(data=query))

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages

    def _organize_prompt_messages(self) -> list[PromptMessage]:
        """
        Organize
        """
        # organize system prompt
        system_message = self._organize_system_prompt()

        # organize current assistant messages
        agent_scratchpad = self._agent_scratchpad
        if not agent_scratchpad:
            assistant_messages = []
        else:
            content = ""
            for unit in agent_scratchpad:
                if unit.is_final():
                    content += f"Final Answer: {unit.agent_response}"
                else:
                    content += f"Thought: {unit.thought}\n\n"
                    if unit.action_str:
                        content += f"Action: {unit.action_str}\n\n"
                    if unit.observation:
                        content += f"Observation: {unit.observation}\n\n"

            assistant_messages = [AssistantPromptMessage(content=content)]

        # query messages
        query_messages = self._organize_user_query(self._query, [])

        if assistant_messages:
            # organize historic prompt messages
            historic_messages = self._organize_historic_prompt_messages(
                [system_message, *query_messages, *assistant_messages, UserPromptMessage(content="continue")]
            )
            messages = [
                system_message,
                *historic_messages,
                *query_messages,
                *assistant_messages,
                UserPromptMessage(content="continue"),
            ]
        else:
            # organize historic prompt messages
            historic_messages = self._organize_historic_prompt_messages([system_message, *query_messages])
            messages = [system_message, *historic_messages, *query_messages]

        # join all messages
        return messages
