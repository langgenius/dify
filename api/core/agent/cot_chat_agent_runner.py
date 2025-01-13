import json

from core.agent.cot_agent_runner import CotAgentRunner
from core.file import file_manager
from core.model_runtime.entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContent,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.message_entities import ImagePromptMessageContent
from core.model_runtime.utils.encoders import jsonable_encoder


class CotChatAgentRunner(CotAgentRunner):
    def _organize_system_prompt(self) -> SystemPromptMessage:
        """
        Organize system prompt
        """
        if not self.app_config.agent:
            raise ValueError("Agent configuration is not set")

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
            prompt_message_contents: list[PromptMessageContent] = []
            prompt_message_contents.append(TextPromptMessageContent(data=query))

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
            for file in self.files:
                prompt_message_contents.append(
                    file_manager.to_prompt_message_content(
                        file,
                        image_detail_config=image_detail_config,
                    )
                )

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
            assistant_message = AssistantPromptMessage(content="")
            assistant_message.content = ""  # FIXME: type check tell mypy that assistant_message.content is str
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
