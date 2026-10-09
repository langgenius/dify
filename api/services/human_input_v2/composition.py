"""Production composition for shared Human Input v2 services."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.db.session_factory import session_factory
from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError, HumanInputRuntime, PreparedForm
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from libs.datetime_utils import ensure_naive_utc
from models.workflow import WorkflowRun

from .delivery_service import HumanInputDeliveryService
from .email_client import build_email_client
from .form_service import AccountInitiator, EndUserInitiator, FormExecutionContext, HumanInputFormService
from .node_data_migration import HumanInputNodeDataMigrationService
from .runtime import DifyHumanInputRuntime
from .workspace_member_email_lookup import SQLAlchemyWorkspaceMemberEmailLookup


def build_human_input_delivery_service(
    *, tenant_id: TenantId, session_factory: Callable[[], Session]
) -> HumanInputDeliveryService:
    return HumanInputDeliveryService(
        session_factory=session_factory,
        email_client=build_email_client(tenant_id=tenant_id, session_factory=session_factory),
    )


def build_human_input_node_data_migration_service() -> HumanInputNodeDataMigrationService:
    """Compose the read-only migration service for one Console request."""

    return HumanInputNodeDataMigrationService(
        member_email_lookup=SQLAlchemyWorkspaceMemberEmailLookup(session_factory.create_session),
    )


class WorkflowHumanInputRuntime(HumanInputRuntime):
    """Bind services when execution starts, after the run has been persisted.

    Graph construction precedes the run-start persistence layer. In particular,
    do not read the run or calculate a new global deadline in NodeFactory.
    """

    def __init__(self, context: DifyRunContext) -> None:
        self._context = context

    @override
    def prepare_form(
        self,
        *,
        node_execution_id: str,
        node_data: HumanInputNodeData,
        variable_pool: ReadOnlyVariablePool,
    ) -> PreparedForm:
        run_id = get_system_text(variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
        if run_id is None:
            raise HumanInputDeliveryError("Human Input requires a persisted workflow run")
        with session_factory.create_session() as session:
            run = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.tenant_id == self._context.tenant_id,
                    WorkflowRun.app_id == self._context.app_id,
                )
            )
            if run is None:
                raise HumanInputDeliveryError("Human Input workflow run was not found")
            deadline = ensure_naive_utc(run.created_at) + timedelta(
                seconds=dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS
            )
        initiator: AccountInitiator | EndUserInitiator | None = None
        if self._context.user_from == UserFrom.ACCOUNT:
            initiator = AccountInitiator(AccountId(self._context.user_id))
        elif self._context.invoke_from == InvokeFrom.WEB_APP:
            initiator = EndUserInitiator(self._context.user_id)
        context = FormExecutionContext(
            tenant_id=TenantId(self._context.tenant_id),
            app_id=self._context.app_id,
            workflow_run_id=run_id,
            global_timeout_deadline=deadline,
            initiator=initiator,
            debugging_account_id=(
                AccountId(self._context.user_id)
                if self._context.invoke_from == InvokeFrom.DEBUGGER and self._context.user_from == UserFrom.ACCOUNT
                else None
            ),
        )
        return DifyHumanInputRuntime(
            form_service=HumanInputFormService(session_factory=session_factory.get_session_maker(), context=context),
            delivery_service=build_human_input_delivery_service(
                tenant_id=context.tenant_id, session_factory=session_factory.create_session
            ),
        ).prepare_form(node_execution_id=node_execution_id, node_data=node_data, variable_pool=variable_pool)
