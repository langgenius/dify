import tempfile
from binascii import hexlify, unhexlify
from collections.abc import Generator, Mapping
from enum import Enum
from typing import Any

from pydantic import BaseModel

from core.app.llm import deduct_llm_quota
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_manager import ModelManager
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.plugin.entities.request import (
    InvokableModelCatalogItem,
    InvokableModelCatalogPage,
    RequestInvokeLLM,
    RequestInvokeLLMWithStructuredOutput,
    RequestInvokeModeration,
    RequestInvokeMultimodalEmbedding,
    RequestInvokeRerank,
    RequestInvokeSpeech2Text,
    RequestInvokeSummary,
    RequestInvokeTextEmbedding,
    RequestInvokeTTS,
    RequestListModels,
)
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.plugin.plugin_service import PluginService
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.model_invocation_utils import ModelInvocationUtils
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
)
from graphon.model_runtime.entities.message_entities import (
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Tenant
from models.provider_ids import ModelProviderID


def _json_compatible(value: Any) -> Any:
    """Convert model-runtime metadata into stable JSON-compatible values."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {str(_json_compatible(key)): _json_compatible(child) for key, child in value.items()}
    if isinstance(value, list | tuple | set):
        return [_json_compatible(child) for child in value]
    return value


class PluginModelBackwardsInvocation(BaseBackwardsInvocation):
    @staticmethod
    def _get_bound_model_instance(
        *,
        tenant_id: str,
        user_id: str | None,
        provider: str,
        model_type: ModelType,
        model: str,
    ):
        return ModelManager.for_tenant(tenant_id=tenant_id, user_id=user_id).get_model_instance(
            tenant_id=tenant_id,
            provider=provider,
            model_type=model_type,
            model=model,
        )

    @classmethod
    def invoke_llm(
        cls, user_id: str, tenant: Tenant, payload: RequestInvokeLLM
    ) -> Generator[LLMResultChunk, None, None] | LLMResult:
        """
        invoke llm
        """
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
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
        )

        if isinstance(response, Generator):

            def handle() -> Generator[LLMResultChunk, None, None]:
                for chunk in response:
                    if chunk.delta.usage:
                        deduct_llm_quota(tenant_id=tenant.id, model_instance=model_instance, usage=chunk.delta.usage)
                    chunk.prompt_messages = []
                    yield chunk

            return handle()
        else:
            if response.usage:
                deduct_llm_quota(tenant_id=tenant.id, model_instance=model_instance, usage=response.usage)

            def handle_non_streaming(response: LLMResult) -> Generator[LLMResultChunk, None, None]:
                yield LLMResultChunk(
                    model=response.model,
                    prompt_messages=[],
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
    def invoke_llm_with_structured_output(
        cls, user_id: str, tenant: Tenant, payload: RequestInvokeLLMWithStructuredOutput
    ):
        """
        invoke llm with structured output
        """
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        model_schema = model_instance.model_type_instance.get_model_schema(payload.model, model_instance.credentials)

        if not model_schema:
            raise ValueError(f"Model schema not found for {payload.model}")

        response = invoke_llm_with_structured_output(
            provider=payload.provider,
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=payload.prompt_messages,
            json_schema=payload.structured_output_schema,
            tools=payload.tools,
            stop=payload.stop,
            stream=True if payload.stream is None else payload.stream,
            model_parameters=payload.completion_params,
        )

        if isinstance(response, Generator):

            def handle() -> Generator[LLMResultChunkWithStructuredOutput, None, None]:
                for chunk in response:
                    if chunk.delta.usage:
                        deduct_llm_quota(tenant_id=tenant.id, model_instance=model_instance, usage=chunk.delta.usage)
                    chunk.prompt_messages = []
                    yield chunk

            return handle()
        else:
            if response.usage:
                deduct_llm_quota(tenant_id=tenant.id, model_instance=model_instance, usage=response.usage)

            def handle_non_streaming(
                response: LLMResultWithStructuredOutput,
            ) -> Generator[LLMResultChunkWithStructuredOutput, None, None]:
                yield LLMResultChunkWithStructuredOutput(
                    model=response.model,
                    prompt_messages=[],
                    system_fingerprint=response.system_fingerprint,
                    structured_output=response.structured_output,
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
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_text_embedding(texts=payload.texts, input_type=payload.input_type)

        return response

    @classmethod
    def invoke_multimodal_embedding(
        cls,
        user_id: str,
        tenant: Tenant,
        payload: RequestInvokeMultimodalEmbedding,
    ):
        """Invoke multimodal embedding through the tenant-bound model instance."""
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        response = model_instance.invoke_multimodal_embedding(
            multimodel_documents=[document.model_dump(exclude_none=True) for document in payload.documents],
            input_type=payload.input_type,
        )

        return response

    @classmethod
    def invoke_rerank(cls, user_id: str, tenant: Tenant, payload: RequestInvokeRerank):
        """
        invoke rerank
        """
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
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
        )

        return response

    @classmethod
    def list_models(
        cls,
        tenant_id: str,
        user_id: str,
        payload: RequestListModels,
    ) -> InvokableModelCatalogPage:
        """List only models that are active for the tenant's Dify configuration."""
        provider_manager = create_plugin_provider_manager(tenant_id=tenant_id, user_id=user_id)
        active_models = provider_manager.get_configurations(tenant_id).get_models(
            model_type=payload.model_type,
            only_active=True,
        )

        installed_identities: dict[str, str] = {}
        for plugin in PluginService.list(tenant_id):
            existing = installed_identities.get(plugin.plugin_id)
            if existing is not None and existing != plugin.plugin_unique_identifier:
                raise ValueError(f"Ambiguous installed identity for model plugin {plugin.plugin_id}")
            installed_identities[plugin.plugin_id] = plugin.plugin_unique_identifier

        requested_provider = str(ModelProviderID(payload.provider)) if payload.provider else None
        matched_models = [
            model
            for model in active_models
            if (requested_provider is None or model.provider.provider == requested_provider)
            and (payload.model is None or model.model == payload.model)
        ]
        matched_models.sort(key=lambda model: (model.provider.provider, model.model))

        page_models = matched_models[payload.offset : payload.offset + payload.limit]
        items: list[InvokableModelCatalogItem] = []
        for model in page_models:
            provider_id = ModelProviderID(model.provider.provider)
            unique_identifier = installed_identities.get(provider_id.plugin_id)
            if unique_identifier is None:
                raise ValueError(f"Installed identity not found for active model plugin {provider_id.plugin_id}")
            items.append(
                InvokableModelCatalogItem(
                    plugin_id=provider_id.plugin_id,
                    plugin_unique_identifier=unique_identifier,
                    provider=provider_id.provider_name,
                    model=model.model,
                    model_type=model.model_type,
                    capabilities={
                        "deprecated": model.deprecated,
                        "features": _json_compatible(model.features or []),
                        "fetchFrom": _json_compatible(model.fetch_from),
                        "modelProperties": _json_compatible(model.model_properties),
                        "modelType": model.model_type.value,
                        "status": _json_compatible(model.status),
                    },
                )
            )

        next_offset = payload.offset + len(page_models)
        return InvokableModelCatalogPage(
            items=items,
            next_offset=next_offset if next_offset < len(matched_models) else None,
        )

    @classmethod
    def invoke_tts(cls, user_id: str, tenant: Tenant, payload: RequestInvokeTTS):
        """
        invoke tts
        """
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_tts(content_text=payload.content_text, voice=payload.voice)

        def handle() -> Generator[dict[str, Any], None, None]:
            for chunk in response:
                yield {"result": hexlify(chunk).decode("utf-8")}

        return handle()

    @classmethod
    def invoke_speech2text(cls, user_id: str, tenant: Tenant, payload: RequestInvokeSpeech2Text):
        """
        invoke speech2text
        """
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        with tempfile.NamedTemporaryFile(suffix=".mp3", mode="wb", delete=True) as temp:
            temp.write(unhexlify(payload.file))
            temp.flush()
            temp.seek(0)

            response = model_instance.invoke_speech2text(file=temp)

            return {
                "result": response,
            }

    @classmethod
    def invoke_moderation(cls, user_id: str, tenant: Tenant, payload: RequestInvokeModeration):
        """
        invoke moderation
        """
        model_instance = cls._get_bound_model_instance(
            tenant_id=tenant.id,
            user_id=user_id,
            provider=payload.provider,
            model_type=payload.model_type,
            model=payload.model,
        )

        # invoke model
        response = model_instance.invoke_moderation(text=payload.text)

        return {
            "result": response,
        }

    @classmethod
    def get_system_model_max_tokens(cls, tenant_id: str, user_id: str | None = None) -> int:
        """
        get system model max tokens
        """
        return ModelInvocationUtils.get_max_llm_context_tokens(tenant_id=tenant_id, user_id=user_id)

    @classmethod
    def get_prompt_tokens(cls, tenant_id: str, prompt_messages: list[PromptMessage], user_id: str | None = None) -> int:
        """
        get prompt tokens
        """
        return ModelInvocationUtils.calculate_tokens(
            tenant_id=tenant_id,
            prompt_messages=prompt_messages,
            user_id=user_id,
        )

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
            caller_user_id=user_id,
        )

    @classmethod
    def invoke_summary(cls, user_id: str, tenant: Tenant, payload: RequestInvokeSummary):
        """
        invoke summary
        """
        max_tokens = cls.get_system_model_max_tokens(tenant_id=tenant.id, user_id=user_id)
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
                user_id=user_id,
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
                user_id=user_id,
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
        for line in new_lines:
            if len(messages) == 0:
                messages.append(line)
            else:
                if len(messages[-1]) + len(line) < max_tokens * 0.5:
                    messages[-1] += line
                elif get_prompt_tokens(messages[-1] + line) > max_tokens * 0.7:
                    messages.append(line)
                else:
                    messages[-1] += line

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
                user_id=user_id,
            )
            > max_tokens * 0.7
        ):
            return cls.invoke_summary(
                user_id=user_id,
                tenant=tenant,
                payload=RequestInvokeSummary(text=result, instruction=payload.instruction),
            )

        return result
