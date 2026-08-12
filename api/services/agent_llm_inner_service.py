"""API-owned model invocation and Message Credits accounting for dify-agent."""

from __future__ import annotations

import logging
from collections.abc import Callable, Generator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory as default_session_factory
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMUsage
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models import (
    AgentLLMBillingStatus,
    AgentLLMCredentialSource,
    AgentLLMExecutionStatus,
    AgentLLMInvocation,
    Provider,
    ProviderType,
)
from models.model import App
from models.provider_ids import ModelProviderID
from services.credit_pool_service import CreditPoolService
from services.entities.agent_llm_inner import AgentLLMInvokeRequest

logger = logging.getLogger(__name__)


class AgentLLMInnerServiceError(RuntimeError):
    def __init__(self, error_code: str, description: str, *, status_code: int = 500) -> None:
        self.error_code = error_code
        self.description = description
        self.status_code = status_code
        super().__init__(description)


@dataclass(frozen=True)
class _BillingPlan:
    credential_source: AgentLLMCredentialSource
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

    @property
    def invocation_id(self) -> str:
        return self.request.caller.invocation_id


class AgentLLMInnerService:
    """Resolve credentials, charge one invocation, and proxy it through the API model runtime."""

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
        # Let the authoritative quota reservation below decide whether the
        # request can be charged. Provider model status is assembled from a
        # cached balance and may otherwise turn an exhausted pool into a 400
        # before we can persist the rejected invocation.
        if provider_model.status != ModelStatus.QUOTA_EXCEEDED:
            provider_model.raise_for_status()

        plan = self._build_billing_plan(model_instance)
        created = self._create_ledger(request=request, plan=plan)
        if not created:
            raise AgentLLMInnerServiceError(
                "duplicate_invocation",
                f"Agent LLM invocation {caller.invocation_id} has already been accepted.",
                status_code=409,
            )

        if plan.billable:
            try:
                charged = self._charge_pending_invocation(caller.invocation_id)
            except QuotaExceededError as exc:
                self._mark_billing_rejected(caller.invocation_id, exc)
                raise AgentLLMInnerServiceError(
                    "agent_llm_quota_exceeded",
                    str(exc) or "Insufficient Message Credits.",
                    status_code=429,
                ) from exc
            if not charged:
                raise AgentLLMInnerServiceError(
                    "duplicate_invocation",
                    f"Agent LLM invocation {caller.invocation_id} has already been charged.",
                    status_code=409,
                )

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

    def mark_running(self, invocation_id: str) -> None:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            if invocation.execution_status == AgentLLMExecutionStatus.PREPARED:
                invocation.execution_status = AgentLLMExecutionStatus.RUNNING
                invocation.started_at = naive_utc_now()
                session.commit()

    def mark_succeeded(self, invocation_id: str, usage: LLMUsage | None) -> None:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            if invocation.execution_status in {
                AgentLLMExecutionStatus.SUCCEEDED,
                AgentLLMExecutionStatus.FAILED,
            }:
                return
            invocation.execution_status = AgentLLMExecutionStatus.SUCCEEDED
            invocation.usage = usage
            invocation.finished_at = naive_utc_now()
            invocation.error_type = None
            invocation.error_message = None
            session.commit()

    def mark_failed(self, invocation_id: str, error: BaseException, usage: LLMUsage | None = None) -> None:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            if invocation.execution_status == AgentLLMExecutionStatus.SUCCEEDED:
                return
            invocation.execution_status = AgentLLMExecutionStatus.FAILED
            invocation.usage = usage
            invocation.finished_at = naive_utc_now()
            invocation.error_type = type(error).__name__
            invocation.error_message = str(error)
            session.commit()

    def heartbeat(self, invocation_id: str) -> None:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            if invocation.execution_status == AgentLLMExecutionStatus.RUNNING:
                invocation.updated_at = naive_utc_now()
                session.commit()

    @classmethod
    def reconcile_stale(cls, *, stale_after: timedelta, limit: int = 100) -> int:
        """Close interrupted invocations without replaying uncertain charges."""
        cutoff = naive_utc_now() - stale_after
        service = cls()
        with service._session_factory() as session:
            invocation_ids = list(
                session.scalars(
                    select(AgentLLMInvocation.invocation_id)
                    .where(
                        AgentLLMInvocation.updated_at < cutoff,
                        AgentLLMInvocation.execution_status.in_(
                            [AgentLLMExecutionStatus.PREPARED, AgentLLMExecutionStatus.RUNNING]
                        ),
                    )
                    .order_by(AgentLLMInvocation.updated_at)
                    .limit(limit)
                )
            )

        reconciled = 0
        for invocation_id in invocation_ids:
            try:
                if service._reconcile_one(invocation_id, cutoff=cutoff):
                    reconciled += 1
            except Exception:
                logger.exception("Failed to reconcile Agent LLM invocation %s", invocation_id)
        return reconciled

    def _reconcile_one(self, invocation_id: str, *, cutoff: datetime) -> bool:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            if invocation.updated_at >= cutoff or invocation.execution_status not in {
                AgentLLMExecutionStatus.PREPARED,
                AgentLLMExecutionStatus.RUNNING,
            }:
                return False
            if invocation.billing_status == AgentLLMBillingStatus.PENDING:
                # No model call starts before charging returns successfully. A
                # stale PENDING row is therefore never replayed into a new
                # charge; an external billing timeout may have an uncertain
                # outcome, which is recorded explicitly for reconciliation.
                invocation.billing_status = AgentLLMBillingStatus.INDETERMINATE
            invocation.execution_status = AgentLLMExecutionStatus.FAILED
            invocation.finished_at = naive_utc_now()
            invocation.error_type = "InterruptedAgentLLMInvocation"
            invocation.error_message = "Agent LLM invocation was interrupted before a terminal event."
            session.commit()
            return True

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

    def _create_ledger(self, *, request: AgentLLMInvokeRequest, plan: _BillingPlan) -> bool:
        caller = request.caller
        target = request.target
        billing_status = AgentLLMBillingStatus.PENDING if plan.billable else AgentLLMBillingStatus.NOT_BILLABLE
        invocation = AgentLLMInvocation(
            invocation_id=caller.invocation_id,
            tenant_id=caller.tenant_id,
            agent_run_id=caller.agent_run_id,
            call_index=caller.call_index,
            agent_mode=caller.agent_mode,
            invoke_from=caller.invoke_from,
            user_id=caller.user_id,
            user_from=caller.user_from,
            app_id=caller.app_id,
            workflow_id=caller.workflow_id,
            workflow_run_id=caller.workflow_run_id,
            node_id=caller.node_id,
            node_execution_id=caller.node_execution_id,
            conversation_id=caller.conversation_id,
            agent_id=caller.agent_id,
            agent_config_version_id=caller.agent_config_version_id,
            agent_config_version_kind=caller.agent_config_version_kind,
            trace_id=caller.trace_id,
            provider=target.provider,
            model=target.model,
            credential_source=plan.credential_source,
            quota_type=plan.quota_type,
            pool_type=plan.pool_type,
            credits=plan.credits,
            billing_status=billing_status,
            execution_status=AgentLLMExecutionStatus.PREPARED,
        )
        with self._session_factory() as session:
            session.add(invocation)
            try:
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                existing = session.scalar(
                    select(AgentLLMInvocation).where(
                        or_(
                            AgentLLMInvocation.invocation_id == caller.invocation_id,
                            (
                                (AgentLLMInvocation.agent_run_id == caller.agent_run_id)
                                & (AgentLLMInvocation.call_index == caller.call_index)
                            ),
                        )
                    )
                )
                if existing is None:
                    raise
                self._validate_existing_identity(existing, request)
                return False

    def _charge_pending_invocation(self, invocation_id: str) -> bool:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            if invocation.billing_status != AgentLLMBillingStatus.PENDING:
                return False
            if invocation.credits <= 0 or invocation.quota_type is None:
                invocation.billing_status = AgentLLMBillingStatus.NOT_BILLABLE
                session.commit()
                return True

            invocation.billing_status = AgentLLMBillingStatus.CHARGED
            if invocation.quota_type in {ProviderQuotaType.TRIAL.value, ProviderQuotaType.PAID.value}:
                CreditPoolService.check_and_deduct_credits(
                    tenant_id=invocation.tenant_id,
                    credits_required=invocation.credits,
                    pool_type=invocation.pool_type or invocation.quota_type,
                    request_id=invocation.invocation_id,
                    metadata=self._billing_metadata(invocation),
                    session=session,
                )
            elif invocation.quota_type == ProviderQuotaType.FREE.value:
                self._deduct_free_quota(session, invocation)
            else:
                raise AgentLLMInnerServiceError(
                    "unsupported_quota_type",
                    f"Unsupported Agent LLM quota type: {invocation.quota_type}",
                )
            session.commit()
            return True

    @staticmethod
    def _build_billing_plan(model_instance: ModelInstance) -> _BillingPlan:
        configuration = model_instance.provider_model_bundle.configuration
        if configuration.using_provider_type != ProviderType.SYSTEM:
            return _BillingPlan(credential_source=AgentLLMCredentialSource.CUSTOM)

        system_configuration = configuration.system_configuration
        quota_type = system_configuration.current_quota_type
        if quota_type is None:
            return _BillingPlan(credential_source=AgentLLMCredentialSource.SYSTEM)

        quota_configuration = next(
            (item for item in system_configuration.quota_configurations if item.quota_type == quota_type),
            None,
        )
        if quota_configuration is None or quota_configuration.quota_limit == -1:
            return _BillingPlan(
                credential_source=AgentLLMCredentialSource.SYSTEM,
                quota_type=quota_type.value,
            )

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
            credential_source=AgentLLMCredentialSource.SYSTEM,
            quota_type=quota_type.value,
            pool_type=quota_type.value if quota_type in {ProviderQuotaType.TRIAL, ProviderQuotaType.PAID} else None,
            credits=credits,
        )

    @staticmethod
    def _deduct_free_quota(session: Session, invocation: AgentLLMInvocation) -> None:
        provider_record = session.scalar(
            select(Provider)
            .where(
                Provider.tenant_id == invocation.tenant_id,
                Provider.provider_name == ModelProviderID(invocation.provider).provider_name,
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
            or provider_record.quota_limit - provider_record.quota_used < invocation.credits
        ):
            raise QuotaExceededError("Insufficient hosted model quota remaining")
        provider_record.quota_used += invocation.credits
        provider_record.last_used = naive_utc_now()

    @staticmethod
    def _billing_metadata(invocation: AgentLLMInvocation) -> dict[str, str]:
        return {
            "source": "agent_llm_gateway",
            "invocation_id": invocation.invocation_id,
            "agent_run_id": invocation.agent_run_id,
            "agent_mode": invocation.agent_mode,
            "call_index": str(invocation.call_index),
            "provider": invocation.provider,
            "model": invocation.model,
        }

    @staticmethod
    def _validate_existing_identity(existing: AgentLLMInvocation, request: AgentLLMInvokeRequest) -> None:
        caller = request.caller
        target = request.target
        expected = (
            caller.tenant_id,
            caller.agent_run_id,
            caller.call_index,
            caller.agent_mode,
            caller.user_id,
            caller.app_id,
            target.provider,
            target.model,
        )
        actual = (
            existing.tenant_id,
            existing.agent_run_id,
            existing.call_index,
            existing.agent_mode,
            existing.user_id,
            existing.app_id,
            existing.provider,
            existing.model,
        )
        if actual != expected:
            raise AgentLLMInnerServiceError(
                "invocation_identity_conflict",
                "The invocation_id is already bound to a different Agent LLM request.",
                status_code=409,
            )

    @staticmethod
    def _get_invocation_for_update(session: Session, invocation_id: str) -> AgentLLMInvocation:
        invocation = session.scalar(
            select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == invocation_id).with_for_update()
        )
        if invocation is None:
            raise AgentLLMInnerServiceError(
                "invocation_not_found",
                f"Agent LLM invocation {invocation_id} was not found.",
                status_code=404,
            )
        return invocation

    def _mark_billing_rejected(self, invocation_id: str, error: BaseException) -> None:
        with self._session_factory() as session:
            invocation = self._get_invocation_for_update(session, invocation_id)
            invocation.billing_status = AgentLLMBillingStatus.REJECTED
            invocation.execution_status = AgentLLMExecutionStatus.FAILED
            invocation.finished_at = naive_utc_now()
            invocation.error_type = type(error).__name__
            invocation.error_message = str(error)
            session.commit()


__all__ = ["AgentLLMInnerService", "AgentLLMInnerServiceError", "PreparedAgentLLMInvocation"]
