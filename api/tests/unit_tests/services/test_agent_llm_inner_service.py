"""Agent LLM gateway accounting tests backed by the unit-test SQLite database."""

from datetime import timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from core.entities.model_entities import ModelStatus
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from libs.datetime_utils import naive_utc_now
from models import (
    AgentLLMBillingStatus,
    AgentLLMCredentialSource,
    AgentLLMExecutionStatus,
    AgentLLMInvocation,
    TenantCreditPool,
)
from models.enums import ProviderQuotaType
from models.model import App, AppMode
from services.agent_llm_inner_service import AgentLLMInnerService, AgentLLMInnerServiceError, _BillingPlan
from services.entities.agent_llm_inner import AgentLLMInvokeCaller, AgentLLMInvokeRequest, AgentLLMInvokeTarget


def _request(*, invocation_id: str | None = None, agent_run_id: str | None = None) -> AgentLLMInvokeRequest:
    return AgentLLMInvokeRequest(
        caller=AgentLLMInvokeCaller(
            invocation_id=invocation_id or str(uuid4()),
            agent_run_id=agent_run_id or str(uuid4()),
            call_index=1,
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            user_from="account",
            app_id=str(uuid4()),
            invoke_from="debugger",
            agent_mode="workflow_run",
            agent_config_version_kind="draft",
            trace_id="trace-1",
        ),
        target=AgentLLMInvokeTarget(
            provider="openai",
            model="gpt-test",
            prompt_messages=[UserPromptMessage(content="hello")],
        ),
    )


def _model_instance(*, status: ModelStatus = ModelStatus.ACTIVE) -> MagicMock:
    provider_model = MagicMock()
    provider_model.status = status
    configuration = MagicMock()
    configuration.get_provider_model.return_value = provider_model
    model_instance = MagicMock()
    model_instance.provider_model_bundle.configuration = configuration
    return model_instance


def _prepare_with_plan(
    service: AgentLLMInnerService,
    request: AgentLLMInvokeRequest,
    plan: _BillingPlan,
    *,
    session: Session,
    model_status: ModelStatus = ModelStatus.ACTIVE,
) -> None:
    _persist_app(session, request=request)
    manager = MagicMock()
    manager.get_model_instance.return_value = _model_instance(status=model_status)
    with (
        patch("services.agent_llm_inner_service.create_plugin_provider_manager"),
        patch("services.agent_llm_inner_service.ModelManager", return_value=manager),
        patch.object(service, "_build_billing_plan", return_value=plan),
    ):
        service.prepare(request)


def _persist_app(
    session: Session,
    *,
    request: AgentLLMInvokeRequest,
    tenant_id: str | None = None,
) -> App:
    existing = session.get(App, request.caller.app_id)
    if existing is not None:
        return existing
    app = App(
        id=request.caller.app_id,
        tenant_id=tenant_id or request.caller.tenant_id,
        name="Agent LLM gateway test app",
        description="",
        mode=AppMode.CHAT,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
    )
    session.add(app)
    session.commit()
    return app


def _create_pool(session: Session, *, tenant_id: str, quota_limit: int, quota_used: int = 0) -> TenantCreditPool:
    pool = TenantCreditPool(
        tenant_id=tenant_id,
        pool_type=ProviderQuotaType.TRIAL,
        quota_limit=quota_limit,
        quota_used=quota_used,
    )
    session.add(pool)
    session.commit()
    return pool


def test_prepare_rejects_missing_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    request = _request()
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with pytest.raises(AgentLLMInnerServiceError) as exc_info:
        service.prepare(request)

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404


def test_prepare_rejects_cross_tenant_app(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request, tenant_id=str(uuid4()))
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with pytest.raises(AgentLLMInnerServiceError) as exc_info:
        service.prepare(request)

    assert exc_info.value.error_code == "app_tenant_mismatch"
    assert exc_info.value.status_code == 403


def test_system_invocation_is_charged_once_per_run_call(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    pool = _create_pool(sqlite_session, tenant_id=request.caller.tenant_id, quota_limit=10)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    plan = _BillingPlan(
        credential_source=AgentLLMCredentialSource.SYSTEM,
        quota_type="trial",
        pool_type="trial",
        credits=3,
    )

    _prepare_with_plan(service, request, plan, session=sqlite_session)

    sqlite_session.expire_all()
    invocation = sqlite_session.scalar(
        select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
    )
    assert invocation is not None
    assert invocation.billing_status == AgentLLMBillingStatus.CHARGED
    assert invocation.execution_status == AgentLLMExecutionStatus.PREPARED
    assert invocation.user_from == "account"
    assert invocation.agent_config_version_kind == "draft"
    assert invocation.trace_id == "trace-1"
    assert sqlite_session.get(TenantCreditPool, pool.id).quota_used == 3

    with pytest.raises(AgentLLMInnerServiceError, match="already been accepted"):
        _prepare_with_plan(service, request, plan, session=sqlite_session)

    changed_id_request = request.model_copy(
        update={"caller": request.caller.model_copy(update={"invocation_id": str(uuid4())})}
    )
    with pytest.raises(AgentLLMInnerServiceError, match="already been accepted"):
        _prepare_with_plan(service, changed_id_request, plan, session=sqlite_session)

    sqlite_session.expire_all()
    assert sqlite_session.get(TenantCreditPool, pool.id).quota_used == 3


def test_custom_credentials_create_non_billable_ledger(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    _prepare_with_plan(
        service,
        request,
        _BillingPlan(credential_source=AgentLLMCredentialSource.CUSTOM),
        session=sqlite_session,
    )

    invocation = sqlite_session.scalar(
        select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
    )
    assert invocation is not None
    assert invocation.credential_source == AgentLLMCredentialSource.CUSTOM
    assert invocation.billing_status == AgentLLMBillingStatus.NOT_BILLABLE
    assert invocation.credits == 0


def test_insufficient_credits_reject_before_model_invocation(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    pool = _create_pool(sqlite_session, tenant_id=request.caller.tenant_id, quota_limit=2)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    plan = _BillingPlan(
        credential_source=AgentLLMCredentialSource.SYSTEM,
        quota_type="trial",
        pool_type="trial",
        credits=3,
    )

    with pytest.raises(AgentLLMInnerServiceError) as exc_info:
        _prepare_with_plan(
            service,
            request,
            plan,
            session=sqlite_session,
            model_status=ModelStatus.QUOTA_EXCEEDED,
        )

    assert exc_info.value.error_code == "agent_llm_quota_exceeded"
    assert exc_info.value.status_code == 429
    sqlite_session.expire_all()
    invocation = sqlite_session.scalar(
        select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
    )
    assert invocation is not None
    assert invocation.billing_status == AgentLLMBillingStatus.REJECTED
    assert invocation.execution_status == AgentLLMExecutionStatus.FAILED
    assert sqlite_session.get(TenantCreditPool, pool.id).quota_used == 0


def test_terminal_status_does_not_regress_from_succeeded(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    _prepare_with_plan(
        service,
        request,
        _BillingPlan(credential_source=AgentLLMCredentialSource.CUSTOM),
        session=sqlite_session,
    )

    service.mark_running(request.caller.invocation_id)
    service.mark_succeeded(request.caller.invocation_id, usage=None)
    service.mark_failed(request.caller.invocation_id, RuntimeError("late disconnect"))

    sqlite_session.expire_all()
    invocation = sqlite_session.scalar(
        select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
    )
    assert invocation is not None
    assert invocation.execution_status == AgentLLMExecutionStatus.SUCCEEDED
    assert invocation.error_message is None


def test_reconciliation_does_not_create_a_charge_for_unconfirmed_pending_invocation(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    pool = _create_pool(sqlite_session, tenant_id=request.caller.tenant_id, quota_limit=10)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    plan = _BillingPlan(
        credential_source=AgentLLMCredentialSource.SYSTEM,
        quota_type="trial",
        pool_type="trial",
        credits=2,
    )
    assert service._create_ledger(request=request, plan=plan)
    sqlite_session.execute(
        update(AgentLLMInvocation)
        .where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
        .values(updated_at=naive_utc_now() - timedelta(hours=1))
    )
    sqlite_session.commit()

    assert AgentLLMInnerService.reconcile_stale(stale_after=timedelta(minutes=15)) == 1

    sqlite_session.expire_all()
    invocation = sqlite_session.scalar(
        select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
    )
    assert invocation is not None
    assert invocation.billing_status == AgentLLMBillingStatus.INDETERMINATE
    assert invocation.execution_status == AgentLLMExecutionStatus.FAILED
    assert sqlite_session.get(TenantCreditPool, pool.id).quota_used == 0

    assert AgentLLMInnerService.reconcile_stale(stale_after=timedelta(minutes=15)) == 0
    sqlite_session.expire_all()
    assert sqlite_session.get(TenantCreditPool, pool.id).quota_used == 0


def test_reconciliation_closes_confirmed_charge_without_deducting_again(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    pool = _create_pool(sqlite_session, tenant_id=request.caller.tenant_id, quota_limit=10)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    plan = _BillingPlan(
        credential_source=AgentLLMCredentialSource.SYSTEM,
        quota_type="trial",
        pool_type="trial",
        credits=2,
    )
    _prepare_with_plan(service, request, plan, session=sqlite_session)
    service.mark_running(request.caller.invocation_id)
    sqlite_session.execute(
        update(AgentLLMInvocation)
        .where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
        .values(updated_at=naive_utc_now() - timedelta(hours=1))
    )
    sqlite_session.commit()

    assert AgentLLMInnerService.reconcile_stale(stale_after=timedelta(minutes=15)) == 1

    sqlite_session.expire_all()
    invocation = sqlite_session.scalar(
        select(AgentLLMInvocation).where(AgentLLMInvocation.invocation_id == request.caller.invocation_id)
    )
    assert invocation is not None
    assert invocation.billing_status == AgentLLMBillingStatus.CHARGED
    assert invocation.execution_status == AgentLLMExecutionStatus.FAILED
    assert sqlite_session.get(TenantCreditPool, pool.id).quota_used == 2
