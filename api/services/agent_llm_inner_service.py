"""API-owned model invocation and Message Credits accounting for dify-agent."""

from __future__ import annotations

from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory as default_session_factory
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from graphon.model_runtime.entities.llm_entities import LLMResultChunk
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models import Provider, ProviderType
from models.model import App
from models.provider_ids import ModelProviderID
from services.credit_pool_service import CreditPoolService
from services.entities.agent_llm_inner import AgentLLMInvokeRequest


class AgentLLMInnerServiceError(RuntimeError):
    def __init__(self, error_code: str, description: str, *, status_code: int = 500) -> None:
        self.error_code = error_code
        self.description = description
        self.status_code = status_code
        super().__init__(description)


@dataclass(frozen=True)
class _BillingPlan:
    quota_type: str | None = None
    pool_type: str | None = None
    credits: int = 0

    @property
    def billable(self) -> bool:
        return self.credits > 0 and self.quota_type is not None


@dataclass(frozen=True)
class PreparedAgentLLMInvocation:
    request: AgentLLMInvokeRequest
    model_instance: ModelInstance


class AgentLLMInnerService:
    """Resolve credentials, meter hosted usage, and invoke the API model runtime."""

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

        plan = self._build_billing_plan(model_instance)
        if plan.billable:
            try:
                self._charge(request=request, plan=plan)
            except QuotaExceededError as exc:
                raise AgentLLMInnerServiceError(
                    "agent_llm_quota_exceeded",
                    str(exc) or "Insufficient Message Credits.",
                    status_code=429,
                ) from exc

        return PreparedAgentLLMInvocation(request=request, model_instance=model_instance)

    def invoke(self, prepared: PreparedAgentLLMInvocation) -> Generator[LLMResultChunk, None, None]:
        request = prepared.request
        caller = request.caller
        target = request.target
        result = prepared.model_instance.invoke_llm(
            prompt_messages=target.prompt_messages,
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

    def _charge(self, *, request: AgentLLMInvokeRequest, plan: _BillingPlan) -> None:
        quota_type = plan.quota_type
        if quota_type is None:
            raise AgentLLMInnerServiceError("missing_quota_type", "Billable Agent LLM invocation has no quota type.")

        if quota_type in {ProviderQuotaType.TRIAL.value, ProviderQuotaType.PAID.value}:
            with self._session_factory() as session:
                CreditPoolService.check_and_deduct_credits(
                    tenant_id=request.caller.tenant_id,
                    credits_required=plan.credits,
                    pool_type=plan.pool_type or quota_type,
                    request_id=request.caller.invocation_id,
                    metadata=self._billing_metadata(request),
                    session=session,
                )
            return

        if quota_type == ProviderQuotaType.FREE.value:
            with self._session_factory() as session:
                self._deduct_free_quota(session, request=request, credits=plan.credits)
                session.commit()
            return

        raise AgentLLMInnerServiceError(
            "unsupported_quota_type",
            f"Unsupported Agent LLM quota type: {quota_type}",
        )

    @staticmethod
    def _build_billing_plan(model_instance: ModelInstance) -> _BillingPlan:
        configuration = model_instance.provider_model_bundle.configuration
        if configuration.using_provider_type != ProviderType.SYSTEM:
            return _BillingPlan()

        system_configuration = configuration.system_configuration
        quota_type = system_configuration.current_quota_type
        if quota_type is None:
            return _BillingPlan()

        quota_configuration = next(
            (item for item in system_configuration.quota_configurations if item.quota_type == quota_type),
            None,
        )
        if quota_configuration is None or quota_configuration.quota_limit == -1:
            return _BillingPlan(quota_type=quota_type.value)

        if quota_configuration.quota_unit == QuotaUnit.CREDITS:
            credits = dify_config.get_model_credits(model_instance.model_name)
        elif quota_configuration.quota_unit == QuotaUnit.TIMES:
            credits = 1
        else:
            raise AgentLLMInnerServiceError(
                "unsupported_quota_unit",
                "Agent LLM Gateway supports fixed Message Credits quotas only.",
                status_code=422,
            )
        return _BillingPlan(
            quota_type=quota_type.value,
            pool_type=quota_type.value if quota_type in {ProviderQuotaType.TRIAL, ProviderQuotaType.PAID} else None,
            credits=credits,
        )

    @staticmethod
    def _deduct_free_quota(session: Session, *, request: AgentLLMInvokeRequest, credits: int) -> None:
        provider_record = session.scalar(
            select(Provider)
            .where(
                Provider.tenant_id == request.caller.tenant_id,
                Provider.provider_name == ModelProviderID(request.target.provider).provider_name,
                Provider.provider_type == ProviderType.SYSTEM.value,
                Provider.quota_type == ProviderQuotaType.FREE,
            )
            .limit(1)
            .with_for_update()
        )
        if (
            provider_record is None
            or provider_record.quota_limit is None
            or provider_record.quota_used is None
            or provider_record.quota_limit - provider_record.quota_used < credits
        ):
            raise QuotaExceededError("Insufficient hosted model quota remaining")
        provider_record.quota_used += credits
        provider_record.last_used = naive_utc_now()

    @staticmethod
    def _billing_metadata(request: AgentLLMInvokeRequest) -> dict[str, str]:
        caller = request.caller
        target = request.target
        return {
            "source": "agent_llm_gateway",
            "invocation_id": caller.invocation_id,
            "agent_run_id": caller.agent_run_id,
            "agent_mode": caller.agent_mode,
            "call_index": str(caller.call_index),
            "provider": target.provider,
            "model": target.model,
        }


__all__ = ["AgentLLMInnerService", "AgentLLMInnerServiceError", "PreparedAgentLLMInvocation"]
