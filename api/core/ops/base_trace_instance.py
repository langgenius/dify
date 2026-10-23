from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Literal, Protocol, cast

from flask import Flask, current_app, has_app_context
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from extensions.ext_database import db
from models import Account, App

if TYPE_CHECKING:
    from dify_agent.layers.execution_context import ApplicationTracingContext

    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext


class ApplicationTracingHooks(Protocol):
    """Execution-owned port for the application tracing lifecycle.

    The composition root supplies an app-scoped implementation. Core callers
    carry trusted execution context and do not construct services or vendor SDKs.
    """

    def prepare_agent_app(self, context: AgentAppRuntimeBuildContext) -> ApplicationTracingContext | None: ...

    def prepare_workflow_agent(
        self, context: WorkflowAgentRuntimeBuildContext, conversation_id: str | None
    ) -> ApplicationTracingContext | None: ...

    def freeze_workflow_run(
        self,
        entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity,
        *,
        workflow_id: str,
        workflow_run_id: str,
        conversation_id: object,
        graph_data: object,
    ) -> None: ...

    def queue_enabled_at_start(self, app_id: object) -> bool: ...

    def capture_terminal(self, info: BaseTraceInfo) -> bool: ...

    def capture_agent_app_terminal(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        outcome: Literal["succeeded", "failed", "cancelled"],
        output: str | None,
    ) -> None: ...


class ApplicationTracingHooksNotRegisteredError(RetryableTraceDispatchError):
    """Enabled tracing must not silently fall back to a different export path."""

    def __init__(self) -> None:
        super().__init__("application_tracing_hooks_not_registered")


_APPLICATION_TRACING_HOOKS_KEY = "application_tracing_hooks"


def bind_application_tracing_hooks(app: Flask, hooks: ApplicationTracingHooks) -> None:
    """Bind the execution port to one Flask application, never a process singleton."""
    app.extensions[_APPLICATION_TRACING_HOOKS_KEY] = hooks


def application_tracing_hooks() -> ApplicationTracingHooks | None:
    """Resolve the current app's port; a disabled deployment needs no Flask context."""
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return None
    if not has_app_context():
        raise ApplicationTracingHooksNotRegisteredError()
    hooks = current_app.extensions.get(_APPLICATION_TRACING_HOOKS_KEY)
    if hooks is None:
        raise ApplicationTracingHooksNotRegisteredError()
    return cast(ApplicationTracingHooks, hooks)


class BaseTraceInstance(ABC):
    """
    Base trace instance for ops trace services
    """

    def __init__(self, trace_config: BaseTracingConfig):
        """
        Initializer for the trace instance.
        Distribute trace tasks by matching entities
        """
        self.trace_config = trace_config

    @abstractmethod
    def trace(self, trace_info: BaseTraceInfo):
        """
        Abstract method to trace activities.
        Subclasses must implement specific tracing logic for activities.
        """
        ...

    def get_service_account_with_tenant(self, app_id: str) -> Account:
        """
        Get the app creator with the app's tenant and membership role.

        Trace tasks may run after the creator switches workspaces. Bind only the
        returned account's context without changing the creator's current workspace.

        Args:
            app_id: The ID of the app

        Returns:
            Account: The service account with the app's tenant set up

        Raises:
            ValueError: If the app, creator account, app tenant or membership cannot be found
        """
        with Session(db.engine, expire_on_commit=False) as session:
            # Get the app to find its creator
            app_stmt = select(App).where(App.id == app_id)
            app = session.scalar(app_stmt)
            if not app:
                raise ValueError(f"App with id {app_id} not found")

            if not app.created_by:
                raise ValueError(f"App with id {app_id} has no creator (created_by is None)")
            account_stmt = select(Account).where(Account.id == app.created_by)
            service_account = session.scalar(account_stmt)
            if not service_account:
                raise ValueError(f"Creator account with id {app.created_by} not found for app {app_id}")

            service_account.set_tenant_id_with_session(app.tenant_id, session=session)
            if service_account.current_tenant_id != app.tenant_id:
                raise ValueError(f"App tenant {app.tenant_id} not found for account {service_account.id}")

            return service_account
