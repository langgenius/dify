"""Tenant-scoped Workflow Tool metadata and execution persistence in short sessions."""

import json

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import ToolNotFoundError
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser, Tenant, Workflow
from models.account import TenantAccountJoin
from models.model import App
from models.tool_runtime_contracts import WorkflowToolDefinition
from models.tools import ToolLabelBinding, WorkflowToolProvider
from repositories.workflow.definition_repository import WorkflowDefinitionStore


def select_workflow_providers(tenant_id: str):
    return select(WorkflowToolProvider).where(WorkflowToolProvider.tenant_id == tenant_id)


class WorkflowToolRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def provider(self, *, tenant_id: str, provider_id: str) -> WorkflowToolProvider | None:
        with self._sessions() as session:
            provider = session.scalar(
                select_workflow_providers(tenant_id).where(WorkflowToolProvider.id == provider_id)
            )
            session.expunge_all()
            return provider

    def provider_for_app(self, *, tenant_id: str, app_id: str) -> WorkflowToolProvider | None:
        with self._sessions() as session:
            return session.scalar(
                select(WorkflowToolProvider)
                .where(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.app_id == app_id)
                .limit(1)
            )

    def providers(self, *, tenant_id: str) -> list[WorkflowToolProvider]:
        with self._sessions() as session:
            return list(session.scalars(select_workflow_providers(tenant_id)))

    def current_workflow(self, *, tenant_id: str, app_id: str) -> Workflow:
        with self._sessions() as session:
            workflow_id = session.scalar(select(App.workflow_id).where(App.id == app_id, App.tenant_id == tenant_id))
            workflow = (
                WorkflowDefinitionStore.get_by_id(session, tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id)
                if workflow_id
                else None
            )
            if workflow is None:
                raise ToolNotFoundError("workflow not found or not published")
            return workflow

    def app(self, *, tenant_id: str, app_id: str) -> App:
        with self._sessions() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
            if app is None:
                raise ToolNotFoundError("app not found")
            session.expunge(app)
            return app

    def workflow(self, *, tenant_id: str, app_id: str, version: str) -> Workflow:
        with self._sessions() as session:
            workflow = WorkflowDefinitionStore.get_by_version(
                session, tenant_id=tenant_id, app_id=app_id, version=version
            )
            if workflow is None:
                raise ToolNotFoundError("workflow not found or not published")
            session.expunge(workflow)
            return workflow

    def actor(self, *, tenant_id: str, user_id: str) -> Account | EndUser | None:
        with self._sessions() as session:
            tenant = session.get(Tenant, tenant_id)
            if tenant is None:
                return None
            account = session.scalar(
                select(Account)
                .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                .where(Account.id == user_id, TenantAccountJoin.tenant_id == tenant_id)
            )
            if account is not None:
                account.set_current_tenant_with_session(tenant, session=session)
                session.expunge(account)
                return account
            user = session.scalar(select(EndUser).where(EndUser.id == user_id, EndUser.tenant_id == tenant_id))
            session.expunge_all()
            return user

    def labels(self, *, tenant_id: str, provider_ids: list[str]) -> dict[str, list[str]]:
        if not provider_ids:
            return {}
        with self._sessions() as session:
            rows = session.execute(
                select(ToolLabelBinding.tool_id, ToolLabelBinding.label_name)
                .join(WorkflowToolProvider, WorkflowToolProvider.id == ToolLabelBinding.tool_id)
                .where(
                    WorkflowToolProvider.tenant_id == tenant_id,
                    WorkflowToolProvider.id.in_(provider_ids),
                    ToolLabelBinding.tool_type == "workflow",
                )
            )
            result: dict[str, list[str]] = {}
            for provider_id, label in rows:
                result.setdefault(provider_id, []).append(label)
            return result

    def save(self, provider: WorkflowToolDefinition, *, labels: list[str] | None, create: bool) -> None:
        with self._sessions.begin() as session:
            app = session.scalar(
                select(App).where(App.id == provider.app_id, App.tenant_id == provider.tenant_id).with_for_update()
            )
            if app is None:
                raise ToolNotFoundError("app not found")
            workflow = (
                WorkflowDefinitionStore.get_by_id(
                    session, tenant_id=provider.tenant_id, app_id=app.id, workflow_id=app.workflow_id
                )
                if app.workflow_id
                else None
            )
            if workflow is None or workflow.version != provider.version:
                raise ToolNotFoundError("Published workflow changed; reload the tool configuration")
            duplicate = session.scalar(
                select(WorkflowToolProvider.id)
                .where(
                    WorkflowToolProvider.tenant_id == provider.tenant_id,
                    WorkflowToolProvider.id != provider.id,
                    or_(WorkflowToolProvider.name == provider.name, WorkflowToolProvider.app_id == provider.app_id),
                )
                .limit(1)
            )
            if duplicate is not None:
                raise ValueError(f"Tool with name {provider.name} or app_id {provider.app_id} already exists")
            if create:
                current = WorkflowToolProvider(
                    tenant_id=provider.tenant_id,
                    user_id=provider.user_id,
                    app_id=provider.app_id,
                    name=provider.name,
                    label=provider.label,
                    icon=provider.icon,
                    description=provider.description,
                    parameter_configuration=json.dumps([p.model_dump() for p in provider.parameter_configurations]),
                    privacy_policy=provider.privacy_policy,
                    version=provider.version,
                )
                current.id = provider.id
                session.add(current)
            else:
                current = session.scalar(
                    select(WorkflowToolProvider)
                    .where(
                        WorkflowToolProvider.id == provider.id,
                        WorkflowToolProvider.tenant_id == provider.tenant_id,
                        WorkflowToolProvider.app_id == provider.app_id,
                    )
                    .with_for_update()
                )
                if current is None:
                    raise ToolNotFoundError(f"Tool {provider.id} not found")
                current.name = provider.name
                current.label = provider.label
                current.icon = provider.icon
                current.description = provider.description
                current.parameter_configuration = json.dumps(
                    [p.model_dump() for p in provider.parameter_configurations]
                )
                current.privacy_policy = provider.privacy_policy
                current.version = provider.version
                current.updated_at = naive_utc_now()
            session.flush()
            if labels is not None:
                session.execute(
                    delete(ToolLabelBinding).where(
                        ToolLabelBinding.tool_id == provider.id, ToolLabelBinding.tool_type == "workflow"
                    )
                )
                session.add_all(
                    ToolLabelBinding(tool_id=provider.id, tool_type=ToolProviderType.WORKFLOW, label_name=label)
                    for label in labels
                )

    def delete(self, *, tenant_id: str, provider_id: str) -> None:
        with self._sessions.begin() as session:
            provider = session.scalar(
                select(WorkflowToolProvider)
                .where(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == provider_id)
                .with_for_update()
            )
            if provider is not None:
                session.execute(
                    delete(ToolLabelBinding).where(
                        ToolLabelBinding.tool_id == provider_id, ToolLabelBinding.tool_type == "workflow"
                    )
                )
                session.delete(provider)
