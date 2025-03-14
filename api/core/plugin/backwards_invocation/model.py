import tempfile
from binascii import hexlify, unhexlify
from collections.abc import Generator

from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeLLM,
    RequestInvokeModeration,
    RequestInvokeRerank,
    RequestInvokeSpeech2Text,
    RequestInvokeSummary,
    RequestInvokeTextEmbedding,
    RequestInvokeTTS,
)
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.model_invocation_utils import ModelInvocationUtils
from core.workflow.nodes.llm.node import LLMNode
from models.account import Tenant


class PluginModelBackwardsInvocation(BaseBackwardsInvocation):
    @classmethod
    def invoke_llm(
        cls, user_id: str, tenant: Tenant, payload: RequestInvokeLLM
    ) -> Generator[LLMResultChunk, None, None] | LLMResult:
        """
        invoke llm
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_llm(
            prompt_messages=payload.prompt_messages,
            model_parameters=payload.completion_params,
            tools=payload.tools,
            stop=payload.stop,
            stream=True if payload.stream is None else payload.stream,
            user=user_id,
        )

        if isinstance(response, Generator):

            def handle() -> Generator[LLMResultChunk, None, None]:
                for chunk in response:
                    if chunk.delta.usage:
                        LLMNode.deduct_llm_quota(
                            tenant_id=tenant.id, model_instance=model_instance, usage=chunk.delta.usage
                        )
                    yield chunk

            return handle()
        else:
            if response.usage:
                LLMNode.deduct_llm_quota(tenant_id=tenant.id, model_instance=model_instance, usage=response.usage)

            def handle_non_streaming(response: LLMResult) -> Generator[LLMResultChunk, None, None]:
                yield LLMResultChunk(
                    model=response.model,
                    prompt_messages=response.prompt_messages,
                    system_fingerprint=response.system_fingerprint,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=response.message,
                        usage=response.usage,
                        finish_reason="",
                    ),
                )

            return handle_non_streaming(response)

    @classmethod
    def invoke_text_embedding(cls, user_id: str, tenant: Tenant, payload: RequestInvokeTextEmbedding):
        """
        invoke text embedding
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_text_embedding(
            texts=payload.texts,
            user=user_id,
        )

        return response

    @classmethod
    def invoke_rerank(cls, user_id: str, tenant: Tenant, payload: RequestInvokeRerank):
        """
        invoke rerank
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_rerank(
            query=payload.query,
            docs=payload.docs,
            score_threshold=payload.score_threshold,
            top_n=payload.top_n,
            user=user_id,
        )

        return response

    @classmethod
    def invoke_tts(cls, user_id: str, tenant: Tenant, payload: RequestInvokeTTS):
        """
        invoke tts
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_tts(
            content_text=payload.content_text,
            tenant_id=tenant.id,
            voice=payload.voice,
            user=user_id,
        )

        def handle() -> Generator[dict, None, None]:
            for chunk in response:
                yield {"result": hexlify(chunk).decode("utf-8")}

        return handle()

    @classmethod
    def invoke_speech2text(cls, user_id: str, tenant: Tenant, payload: RequestInvokeSpeech2Text):
        """
        invoke speech2text
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        with tempfile.NamedTemporaryFile(suffix=".mp3", mode="wb", delete=True) as temp:
            temp.write(unhexlify(payload.file))
            temp.flush()
            temp.seek(0)

            response = model_instance.invoke_speech2text(
                file=temp,
                user=user_id,
            )

            return {
                "result": response,
            }

    @classmethod
    def invoke_moderation(cls, user_id: str, tenant: Tenant, payload: RequestInvokeModeration):
        """
        invoke moderation
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant.id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_moderation(
            text=payload.text,
            user=user_id,
        )

        return {
            "result": response,
        }

    @classmethod
    def get_system_model_max_tokens(cls, tenant_id: str) -> int:
        """
        get system model max tokens
        """
        return ModelInvocationUtils.get_max_llm_context_tokens(tenant_id=tenant_id)

    @classmethod
    def get_prompt_tokens(cls, tenant_id: str, prompt_messages: list[PromptMessage]) -> int:
        """
        get prompt tokens
        """
        return ModelInvocationUtils.calculate_tokens(tenant_id=tenant_id, prompt_messages=prompt_messages)

    @classmethod
    def invoke_system_model(
        cls,
        user_id: str,
        tenant: Tenant,
        prompt_messages: list[PromptMessage],
    ) -> LLMResult:
        """
        invoke system model
        """
        return ModelInvocationUtils.invoke(
            user_id=user_id,
            tenant_id=tenant.id,
            tool_type=ToolProviderType.PLUGIN,
            tool_name="plugin",
            prompt_messages=prompt_messages,
        )

    @classmethod
    def invoke_summary(cls, user_id: str, tenant: Tenant, payload: RequestInvokeSummary):
        """
        invoke summary
        """
        max_tokens = cls.get_system_model_max_tokens(tenant_id=tenant.id)
        content = payload.text

        SUMMARY_PROMPT = """You are a professional language researcher, you are interested in the language
and you can quickly aimed at the main point of an webpage and reproduce it in your own words but 
retain the original meaning and keep the key points. 
however, the text you got is too long, what you got is possible a part of the text.
Please summarize the text you got.

Here is the extra instruction you need to follow:
<extra_instruction>
{payload.instruction}
</extra_instruction>
"""

        if (
            cls.get_prompt_tokens(
                tenant_id=tenant.id,
                prompt_messages=[UserPromptMessage(content=content)],
            )
            < max_tokens * 0.6
        ):
            return content

        def get_prompt_tokens(content: str) -> int:
            return cls.get_prompt_tokens(
                tenant_id=tenant.id,
                prompt_messages=[
                    SystemPromptMessage(content=SUMMARY_PROMPT.replace("{payload.instruction}", payload.instruction)),
                    UserPromptMessage(content=content),
                ],
            )

        def summarize(content: str) -> str:
            summary = cls.invoke_system_model(
                user_id=user_id,
                tenant=tenant,
                prompt_messages=[
                    SystemPromptMessage(content=SUMMARY_PROMPT.replace("{payload.instruction}", payload.instruction)),
                    UserPromptMessage(content=content),
                ],
            )

            assert isinstance(summary.message.content, str)
            return summary.message.content

        lines = content.split("\n")
        new_lines: list[str] = []
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
        for i in new_lines:  # type: ignore
            if len(messages) == 0:
                messages.append(i)  # type: ignore
            else:
                if len(messages[-1]) + len(i) < max_tokens * 0.5:  # type: ignore
                    messages[-1] += i  # type: ignore
                if get_prompt_tokens(messages[-1] + i) > max_tokens * 0.7:  # type: ignore
                    messages.append(i)  # type: ignore
                else:
                    messages[-1] += i  # type: ignore

        summaries = []
        for i in range(len(messages)):
            message = messages[i]
            summary = summarize(message)
            summaries.append(summary)

        result = "\n".join(summaries)

        if (
            cls.get_prompt_tokens(
                tenant_id=tenant.id,
                prompt_messages=[UserPromptMessage(content=result)],
            )
            > max_tokens * 0.7
        ):
            return cls.invoke_summary(
                user_id=user_id,
                tenant=tenant,
                payload=RequestInvokeSummary(text=result, instruction=payload.instruction),
            )

        return result
