import binascii
import json
from collections.abc import Generator, Sequence
from typing import IO, Any, override
from uuid import uuid4

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities import PluginCredentialType
from core.entities.provider_entities import TokenerHostedModelCredentials
from core.helper import encrypter
from core.helper.credential_utils import runtime_check_credential_policy_compliance
from core.plugin.entities.plugin_daemon import (
    PluginBasicBooleanResponse,
    PluginDaemonInnerError,
    PluginLLMNumTokensResponse,
    PluginModelProviderBinding,
    PluginModelProviderEntity,
    PluginModelSchemaEntity,
    PluginStringResultResponse,
    PluginTextEmbeddingNumTokensResponse,
    PluginTTSResultResponse,
    PluginVoicesResponse,
    TTSAudioChunk,
)
from core.plugin.impl.base import BasePluginClient
from core.plugin.impl.exc import PluginInvokeError, PluginLLMPollingUnsupportedError
from graphon.model_runtime.entities.llm_entities import LLMPollingResult, LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from graphon.model_runtime.utils.encoders import jsonable_encoder
from models.provider_ids import ModelProviderID
from repositories.tokener_bootstrap_repository import TokenerBootstrapRepository
from services.plugin.dispatch_identity import plugin_dispatch_headers

_POLLING_UNSUPPORTED_INVOKE_ERROR_TYPES = frozenset((NotImplementedError.__name__,))
_POLLING_UNSUPPORTED_ERROR_MESSAGE = "does not support polling"
_MANAGED_MODEL_ROUTE = "_managed_model_route"
_HOSTED_REDIRECT_OPERATIONS = frozenset(
    (
        "llm/invoke",
        "llm/num_tokens",
        "model/polling/start",
        "model/polling/check",
        "text_embedding/invoke",
        "text_embedding/num_tokens",
        "multimodal_embedding/invoke",
        "rerank/invoke",
        "multimodal_rerank/invoke",
        "tts/invoke",
        "tts/model/voices",
        "speech2text/invoke",
        "moderation/invoke",
    )
)


class PluginModelClient(BasePluginClient):
    @override
    def _prepare_request(
        self,
        path: str,
        headers: dict[str, str] | None,
        data: bytes | dict[str, Any] | str | None,
        params: dict[str, Any] | None,
        files: dict[str, Any] | None,
    ) -> tuple[str, dict[str, str], bytes | dict[str, Any] | str | None, dict[str, Any] | None, dict[str, Any] | None]:
        """Resolve an admitted SYSTEM binding or send the untouched normal request.

        The dispatch marker can only be built from typed provider credentials.
        Failed bindings never fall back to a vendor key or the old meter.
        """
        if isinstance(data, dict) and _MANAGED_MODEL_ROUTE in data:
            route = data[_MANAGED_MODEL_ROUTE]
            prefix, separator, operation = path.partition("/dispatch/")
            logical_provider = ModelProviderID(route["provider"])
            source = data["data"]
            if (
                not separator
                or prefix != f"plugin/{route['tenant_id']}"
                or operation not in _HOSTED_REDIRECT_OPERATIONS
                or (headers or {}).get("X-Plugin-ID") != logical_provider.plugin_id
                or source.get("provider") != logical_provider.provider_name
                or source.get("model") != route["model"]
                or source.get("model_type") != route["model_type"]
                or files is not None
            ):
                raise ValueError("Managed model route does not match the invocation.")

            data = {key: value for key, value in data.items() if key != _MANAGED_MODEL_ROUTE}
            data["redirect"] = self._tokener_target(route["tenant_id"], route["model_type"], route["model"])
            path = f"{prefix}/dispatch/redirect/v1/{operation}"
        return super()._prepare_request(path, headers, data, params, files)

    @staticmethod
    def _tokener_target(tenant_id: str, model_type: str, model: str) -> dict[str, Any]:
        """Load only the bound managed key, with no fallback and no parameter translation."""
        try:
            provider = ModelProviderID(dify_config.TOKENER_PROVIDER_NAME)
            repository = TokenerBootstrapRepository(sessions=session_factory.create_session)
            binding = repository.ready_dispatch_binding(tenant_id, str(provider))
            if binding is None:
                raise ValueError("No ready binding.")
            identifier, credential_id, encrypted = binding
            if identifier.partition(":")[0] != provider.plugin_id:
                raise ValueError("Invalid target package.")
            runtime_check_credential_policy_compliance(
                credential_id=credential_id, provider=str(provider), credential_type=PluginCredentialType.MODEL
            )
            values = json.loads(encrypted)
            encrypted_key = values.get("api_key")
            if not isinstance(encrypted_key, str) or not encrypted_key:
                raise ValueError("Missing managed key.")
            credentials = {"api_key": encrypter.decrypt_token(tenant_id=tenant_id, token=encrypted_key)}
            endpoint_url = values.get("endpoint_url")
            if isinstance(endpoint_url, str) and endpoint_url:
                credentials["endpoint_url"] = endpoint_url
        except Exception:
            raise ValueError("Managed model routing is temporarily unavailable.") from None
        return {
            "version": 1,
            "route_id": str(uuid4()),
            "target": {
                "plugin_id": provider.plugin_id,
                "expected_unique_identifier": identifier,
                "provider": provider.provider_name,
                "model_type": model_type,
                "model": model,
                "credentials": credentials,
            },
        }

    @staticmethod
    def _dispatch_payload(*, user_id: str | None, data: dict[str, Any], app_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"data": data}
        credentials = data.get("credentials")
        if isinstance(credentials, TokenerHostedModelCredentials):
            payload[_MANAGED_MODEL_ROUTE] = {
                "tenant_id": credentials.tenant_id,
                "provider": credentials.provider,
                "model_type": credentials.model_type,
                "model": credentials.model,
            }
            payload["data"] = {**data, "credentials": {}}
            payload["user_id"] = ""
        if user_id is not None:
            payload["user_id"] = user_id
        if app_id is not None:
            payload["app_id"] = app_id
        return payload

    def fetch_model_providers(self, tenant_id: str) -> Sequence[PluginModelProviderEntity]:
        """
        Fetch model providers for the given tenant.
        """
        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/models",
            list[PluginModelProviderEntity],
            params={"page": 1, "page_size": 256},
        )
        return response

    def fetch_model_provider_bindings(self, tenant_id: str) -> Sequence[PluginModelProviderBinding]:
        """Fetch only model-provider installation identities from the daemon."""
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/models/bindings",
            list[PluginModelProviderBinding],
        )

    def get_model_schema(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        """
        Get model schema
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/schema",
            PluginModelSchemaEntity,
            data=self._dispatch_payload(
                user_id=user_id,
                data={
                    "provider": provider,
                    "model_type": model_type,
                    "model": model,
                    # Discovery belongs to the original provider. Do not use
                    # the target schema to filter the original App parameters.
                    "credentials": {} if isinstance(credentials, TokenerHostedModelCredentials) else credentials,
                },
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.model_schema

        return None

    def validate_provider_credentials(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/validate_provider_credentials",
            PluginBasicBooleanResponse,
            data=self._dispatch_payload(
                user_id=user_id,
                data={
                    "provider": provider,
                    "credentials": credentials,
                },
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            if resp.credentials and isinstance(resp.credentials, dict):
                credentials.update(resp.credentials)

            return resp.result

        return False

    def validate_model_credentials(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        """
        validate the credentials of the provider
        """
        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/model/validate_model_credentials",
            PluginBasicBooleanResponse,
            data=self._dispatch_payload(
                user_id=user_id,
                data={
                    "provider": provider,
                    "model_type": model_type,
                    "model": model,
                    "credentials": credentials,
                },
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            if resp.credentials and isinstance(resp.credentials, dict):
                credentials.update(resp.credentials)

            return resp.result

        return False

    def invoke_llm(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        app_id: str | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> Generator[LLMResultChunk]:
        """
        Invoke llm
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/llm/invoke",
            type_=LLMResultChunk,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "llm",
                        "model": model,
                        "credentials": credentials,
                        "prompt_messages": prompt_messages,
                        "model_parameters": model_parameters,
                        "tools": tools,
                        "stop": stop,
                        "stream": stream,
                    },
                    app_id=app_id,
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        try:
            yield from response
        except PluginDaemonInnerError as e:
            raise ValueError(e.message + str(e.code)) from e

    def start_llm_polling(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        json_schema: dict[str, Any] | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> LLMPollingResult:
        """Start an LLM polling request for plugin-backed long-running jobs."""
        try:
            return self._request_with_plugin_daemon_response(
                method="POST",
                path=f"plugin/{tenant_id}/dispatch/model/polling/start",
                type_=LLMPollingResult,
                data=jsonable_encoder(
                    self._dispatch_payload(
                        user_id=user_id,
                        data={
                            "provider": provider,
                            "model_type": ModelType.LLM.value,
                            "model": model,
                            "credentials": credentials,
                            "prompt_messages": prompt_messages,
                            "model_parameters": model_parameters,
                            "tools": tools,
                            "stop": stop,
                            "stream": False,
                            "json_schema": json_schema,
                        },
                    )
                ),
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
        except PluginInvokeError as error:
            self._raise_typed_polling_unsupported_error(error)
            raise

    def check_llm_polling(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        plugin_state: dict[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> LLMPollingResult:
        """Check the latest state for a plugin-backed LLM polling job."""
        try:
            return self._request_with_plugin_daemon_response(
                method="POST",
                path=f"plugin/{tenant_id}/dispatch/model/polling/check",
                type_=LLMPollingResult,
                data=jsonable_encoder(
                    self._dispatch_payload(
                        user_id=user_id,
                        data={
                            "provider": provider,
                            "model_type": ModelType.LLM.value,
                            "model": model,
                            "credentials": credentials,
                            "plugin_state": plugin_state,
                        },
                    )
                ),
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
        except PluginInvokeError as error:
            self._raise_typed_polling_unsupported_error(error)
            raise

    @staticmethod
    def _raise_typed_polling_unsupported_error(error: PluginInvokeError) -> None:
        """Convert plugin polling capability failures into a dedicated Dify exception."""
        if error.get_error_type() == PluginLLMPollingUnsupportedError.__name__:
            raise PluginLLMPollingUnsupportedError(description=error.description) from error

        if (
            error.get_error_type() in _POLLING_UNSUPPORTED_INVOKE_ERROR_TYPES
            # This is ugly, we should not rely on error messages while checking
            # error types.
            and _POLLING_UNSUPPORTED_ERROR_MESSAGE in error.get_error_message().lower()
        ):
            raise PluginLLMPollingUnsupportedError(description=error.description) from error

    def get_llm_num_tokens(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> int:
        """
        Get number of tokens for llm
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/llm/num_tokens",
            type_=PluginLLMNumTokensResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": model_type,
                        "model": model,
                        "credentials": credentials,
                        "prompt_messages": prompt_messages,
                        "tools": tools,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.num_tokens

        return 0

    def invoke_text_embedding(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        input_type: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> EmbeddingResult:
        """
        Invoke text embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/text_embedding/invoke",
            type_=EmbeddingResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "texts": texts,
                        "input_type": input_type,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke text embedding")

    def invoke_multimodal_embedding(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        documents: list[dict],
        input_type: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> EmbeddingResult:
        """
        Invoke file embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/multimodal_embedding/invoke",
            type_=EmbeddingResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "documents": documents,
                        "input_type": input_type,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke file embedding")

    def get_text_embedding_num_tokens(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        texts: list[str],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> list[int]:
        """
        Get number of tokens for text embedding
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/text_embedding/num_tokens",
            type_=PluginTextEmbeddingNumTokensResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "text-embedding",
                        "model": model,
                        "credentials": credentials,
                        "texts": texts,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.num_tokens

        return []

    def invoke_rerank(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: str,
        docs: list[str],
        score_threshold: float | None = None,
        top_n: int | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> RerankResult:
        """
        Invoke rerank
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/rerank/invoke",
            type_=RerankResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "rerank",
                        "model": model,
                        "credentials": credentials,
                        "query": query,
                        "docs": docs,
                        "score_threshold": score_threshold,
                        "top_n": top_n,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp

        raise ValueError("Failed to invoke rerank")

    def invoke_multimodal_rerank(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        query: MultimodalRerankInput,
        docs: list[MultimodalRerankInput],
        score_threshold: float | None = None,
        top_n: int | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> RerankResult:
        """
        Invoke multimodal rerank
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/multimodal_rerank/invoke",
            type_=RerankResult,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "rerank",
                        "model": model,
                        "credentials": credentials,
                        "query": query,
                        "docs": docs,
                        "score_threshold": score_threshold,
                        "top_n": top_n,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )
        for resp in response:
            return resp

        raise ValueError("Failed to invoke multimodal rerank")

    def invoke_tts(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        content_text: str,
        voice: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> Generator[TTSAudioChunk]:
        """
        Invoke tts
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/tts/invoke",
            type_=PluginTTSResultResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "tts",
                        "model": model,
                        "credentials": credentials,
                        "tenant_id": tenant_id,
                        "content_text": content_text,
                        "voice": voice,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        try:
            for result in response:
                hex_str = result.result
                yield TTSAudioChunk(binascii.unhexlify(hex_str), mime_type=result.mime_type)
        except PluginDaemonInnerError as e:
            raise ValueError(e.message + str(e.code)) from e

    def get_tts_model_voices(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        language: str | None = None,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> list[TTSModelVoice]:
        """
        Get tts model voices
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/tts/model/voices",
            type_=PluginVoicesResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "tts",
                        "model": model,
                        "credentials": credentials,
                        "language": language,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            voices: list[TTSModelVoice] = []
            for voice in resp.voices:
                voices.append({"name": voice.name, "value": voice.value})

            return voices

        return []

    def invoke_speech_to_text(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        file: IO[bytes],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> str:
        """
        Invoke speech to text
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/speech2text/invoke",
            type_=PluginStringResultResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "speech2text",
                        "model": model,
                        "credentials": credentials,
                        "file": binascii.hexlify(file.read()).decode(),
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.result

        raise ValueError("Failed to invoke speech to text")

    def invoke_moderation(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        """
        Invoke moderation
        """
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/moderation/invoke",
            type_=PluginBasicBooleanResponse,
            data=jsonable_encoder(
                self._dispatch_payload(
                    user_id=user_id,
                    data={
                        "provider": provider,
                        "model_type": "moderation",
                        "model": model,
                        "credentials": credentials,
                        "text": text,
                    },
                )
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )

        for resp in response:
            return resp.result

        raise ValueError("Failed to invoke moderation")

    def invoke_moderation_direct(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        *,
        plugin_unique_identifier: str,
    ) -> bool:
        """Invoke a server-selected package without requiring a tenant installation.

        Preconditions: The caller admits the tenant and selects a trusted pinned
        package whose runtime is already available. The daemon server key remains
        mandatory. Postconditions: The JSON payload retains tenant/user context;
        the identifier is mandatory and must match plugin_id. Daemon and empty
        response failures propagate without installation or credential fallback.
        """
        if not tenant_id.strip():
            raise ValueError("A tenant is required for direct moderation dispatch")
        if not plugin_unique_identifier.strip():
            raise ValueError("A plugin unique identifier is required for direct moderation dispatch")
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path="v2/invoke/dispatch/moderation/invoke",
            type_=PluginBasicBooleanResponse,
            data=jsonable_encoder(
                {
                    "tenant_id": tenant_id,
                    **self._dispatch_payload(
                        user_id=user_id,
                        data={
                            "provider": provider,
                            "model_type": "moderation",
                            "model": model,
                            "credentials": credentials,
                            "text": text,
                        },
                    ),
                }
            ),
            headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
        )
        for result in response:
            return result.result
        raise ValueError("Failed to invoke moderation")
