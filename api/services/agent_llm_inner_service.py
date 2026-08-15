"""API-owned model invocation for dify-agent."""

from __future__ import annotations

from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import cast

from sqlalchemy.orm import Session

from core.db.session_factory import session_factory as default_session_factory
from core.entities.model_entities import ModelStatus
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from graphon.model_runtime.entities.llm_entities import LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from models.model import App
from services.entities.agent_llm_inner import AgentLLMInvokeRequest


class AgentLLMInnerServiceError(RuntimeError):
    def __init__(self, error_code: str, description: str, *, status_code: int = 500) -> None:
        self.error_code = error_code
        self.description = description
        self.status_code = status_code
        super().__init__(description)


@dataclass(frozen=True)
class PreparedAgentLLMInvocation:
    request: AgentLLMInvokeRequest
    model_instance: ModelInstance


class AgentLLMInnerService:
    """Resolve the model and invoke it through the API model runtime."""

    def __init__(self, *, session_factory: Callable[[], Session] | None = None) -> None:
        self._session_factory = session_factory or default_session_factory.create_session

    def prepare(self, request: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        caller = request.caller
        target = request.target
        self._validate_app_tenant(app_id=caller.app_id, tenant_id=caller.tenant_id)
        provider_manager = create_plugin_provider_manager(tenant_id=caller.tenant_id, user_id=caller.user_id)
        model_manager = ModelManager(provider_manager=provider_manager)
        model_instance = model_manager.get_model_instance(
            tenant_id=caller.tenant_id,
            provider=target.provider,
            model_type=ModelType.LLM,
            model=target.model,
        )

        provider_configuration = model_instance.provider_model_bundle.configuration
        provider_model = provider_configuration.get_provider_model(model_type=ModelType.LLM, model=target.model)
        if provider_model is None:
            raise AgentLLMInnerServiceError(
                "model_not_found",
                f"Model {target.model} does not exist for provider {target.provider}.",
                status_code=404,
            )
        # The cached model status can lag behind the authoritative reservation.
        # Preserve other provider errors, but let quota reservation produce 429.
        if provider_model.status != ModelStatus.QUOTA_EXCEEDED:
            provider_model.raise_for_status()

        return PreparedAgentLLMInvocation(request=request, model_instance=model_instance)

    def invoke(self, prepared: PreparedAgentLLMInvocation) -> Generator[LLMResultChunk, None, None]:
        request = prepared.request
        caller = request.caller
        target = request.target
        result = prepared.model_instance.invoke_llm(
            prompt_messages=cast(list[PromptMessage], target.prompt_messages),
            model_parameters=target.model_parameters,
            tools=target.tools,
            stop=target.stop,
            # The gateway transport is always streamed, including Pydantic AI's
            # non-streaming request path, so one response protocol is sufficient.
            stream=True,
            request_metadata={
                "source": "agent_llm_gateway",
                "invocation_id": caller.invocation_id,
                "agent_run_id": caller.agent_run_id,
                "agent_mode": caller.agent_mode,
                "call_index": caller.call_index,
                "app_id": caller.app_id,
                "workflow_run_id": caller.workflow_run_id,
                "node_execution_id": caller.node_execution_id,
                "trace_id": caller.trace_id,
            },
        )
        yield from cast(Generator[LLMResultChunk, None, None], result)

    def _validate_app_tenant(self, *, app_id: str, tenant_id: str) -> None:
        with self._session_factory() as session:
            app = session.get(App, app_id)
            if app is None:
                raise AgentLLMInnerServiceError(
                    "app_not_found",
                    "App not found.",
                    status_code=404,
                )
            if app.tenant_id != tenant_id:
                raise AgentLLMInnerServiceError(
                    "app_tenant_mismatch",
                    "App does not belong to the caller tenant.",
                    status_code=403,
                )


__all__ = ["AgentLLMInnerService", "AgentLLMInnerServiceError", "PreparedAgentLLMInvocation"]
