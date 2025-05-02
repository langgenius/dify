from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.model_invocation_utils import ModelInvocationUtils

_SUMMARY_PROMPT = """You are a professional language researcher, you are interested in the language
and you can quickly aimed at the main point of an webpage and reproduce it in your own words but
retain the original meaning and keep the key points.
however, the text you got is too long, what you got is possible a part of the text.
Please summarize the text you got.
"""


class BuiltinTool(Tool):
    """
    Builtin tool

    :param meta: the meta data of a tool call processing
    """

    provider: str

    def __init__(self, provider: str, **kwargs):
        super().__init__(**kwargs)
        self.provider = provider

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "BuiltinTool":
        """
        fork a new tool with metadata
        :return: the new tool
        """
        return self.__class__(
            entity=self.entity.model_copy(),
            runtime=runtime,
            provider=self.provider,
        )

    def invoke_model(self, user_id: str, prompt_messages: list[PromptMessage], stop: list[str]) -> LLMResult:
        """
        invoke model

        :param user_id: the user id
        :param prompt_messages: the prompt messages
        :param stop: the stop words
        :return: the model result
        """
        # invoke model
        return ModelInvocationUtils.invoke(
            user_id=user_id,
            tenant_id=self.runtime.tenant_id or "",
            tool_type="builtin",
            tool_name=self.entity.identity.name,
            prompt_messages=prompt_messages,
        )

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def get_max_tokens(self) -> int:
        """
        get max tokens

        :return: the max tokens
        """
        if self.runtime is None:
            raise ValueError("runtime is required")

        return ModelInvocationUtils.get_max_llm_context_tokens(
            tenant_id=self.runtime.tenant_id or "",
        )

    def get_prompt_tokens(self, prompt_messages: list[PromptMessage]) -> int:
        """
        get prompt tokens

        :param prompt_messages: the prompt messages
        :return: the tokens
        """
        if self.runtime is None:
            raise ValueError("runtime is required")

        return ModelInvocationUtils.calculate_tokens(
            tenant_id=self.runtime.tenant_id or "", prompt_messages=prompt_messages
        )

    def summary(self, user_id: str, content: str) -> str:
        max_tokens = self.get_max_tokens()

        if self.get_prompt_tokens(prompt_messages=[UserPromptMessage(content=content)]) < max_tokens * 0.6:
            return content

        def get_prompt_tokens(content: str) -> int:
            return self.get_prompt_tokens(
                prompt_messages=[SystemPromptMessage(content=_SUMMARY_PROMPT), UserPromptMessage(content=content)]
            )

        def summarize(content: str) -> str:
            summary = self.invoke_model(
                user_id=user_id,
                prompt_messages=[SystemPromptMessage(content=_SUMMARY_PROMPT), UserPromptMessage(content=content)],
                stop=[],
            )

            assert isinstance(summary.message.content, str)
            return summary.message.content

        lines = content.split("\n")
        new_lines = []
        # split long line into multiple lines
        for i in range(len(lines)):
            line = lines[i]
            if not line.strip():
                continue
            if len(line) < max_tokens * 0.5:
                new_lines.append(line)
            elif get_prompt_tokens(line) > max_tokens * 0.7:
                while get_prompt_tokens(line) > max_tokens * 0.7:
                    new_lines.append(line[: int(max_tokens * 0.5)])
                    line = line[int(max_tokens * 0.5) :]
                new_lines.append(line)
            else:
                new_lines.append(line)

        # merge lines into messages with max tokens
        messages: list[str] = []
        for j in new_lines:
            if len(messages) == 0:
                messages.append(j)
            else:
                if len(messages[-1]) + len(j) < max_tokens * 0.5:
                    messages[-1] += j
                if get_prompt_tokens(messages[-1] + j) > max_tokens * 0.7:
                    messages.append(j)
                else:
                    messages[-1] += j

        summaries = []
        for i in range(len(messages)):
            message = messages[i]
            summary = summarize(message)
            summaries.append(summary)

        result = "\n".join(summaries)

        if self.get_prompt_tokens(prompt_messages=[UserPromptMessage(content=result)]) > max_tokens * 0.7:
            return self.summary(user_id=user_id, content=result)

        return result
