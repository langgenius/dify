"""Agent App persistence, reusing the roster's canonical app and reference queries."""

from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from events.app_event import app_model_config_was_updated
from libs.datetime_utils import naive_utc_now
from models.agent import Agent, AgentConfigDraft, AgentConfigSnapshot
from models.enums import AppStatus
from models.model import App, AppMode, AppModelConfig, AppModelConfigDict
from services.agent.errors import AgentNotFoundError
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppNotFoundError, AgentReferencingWorkflow
from services.model_billing_dependency_inventory import AgentModelSelectors, ModelDependencyDocument


class AgentAppRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def collect_model_dependency_documents(self, tenant_id: str) -> list[ModelDependencyDocument]:
        """Include inactive snapshots and partial drafts without changing bindings."""
        documents: list[ModelDependencyDocument] = []
        with self._session_factory() as session:
            for model, prefix in ((AgentConfigDraft, "draft:"), (AgentConfigSnapshot, "snapshot:")):
                for record in session.scalars(
                    select(model)
                    .join(Agent, Agent.id == model.agent_id)
                    .where(Agent.tenant_id == tenant_id, model.tenant_id == tenant_id)
                ):
                    documents.append(
                        ModelDependencyDocument(
                            tenant_id,
                            "agent",
                            record.agent_id,
                            prefix + record.id,
                            AgentModelSelectors(record.config_snapshot_dict),
                        )
                    )
        return documents

    def resolve_roster_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Resolve a roster Agent's configuration owner without materializing inline Apps."""
        with self._session_factory() as session:
            try:
                return AgentRosterService(session).get_agent_app_model(tenant_id=tenant_id, agent_id=agent_id).id
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def resolve_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        with self._session_factory() as session:
            try:
                return (
                    AgentRosterService(session).get_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id).id
                )
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def resolve_existing_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Read persisted runtime state without creating a hidden app during a GET."""
        with self._session_factory() as session:
            try:
                return (
                    AgentRosterService(session)
                    .get_existing_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
                    .id
                )
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def list_referencing_workflows(self, *, tenant_id: str, agent_id: str) -> list[AgentReferencingWorkflow]:
        with self._session_factory() as session:
            roster = AgentRosterService(session)
            try:
                app = roster.get_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc
            return roster.list_workflows_referencing_app_agent(tenant_id=tenant_id, app_id=app.id)

    def update_features(self, *, tenant_id: str, app_id: str, account_id: str, config: dict[str, Any]) -> None:
        """Commit the feature version, app pointer and dataset joins together."""
        with self._session_factory.begin() as session:
            app = session.scalar(
                select(App).where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.mode == AppMode.AGENT,
                    App.status == AppStatus.NORMAL,
                )
            )
            if app is None:
                raise AgentAppNotFoundError
            new_config = AppModelConfig(
                app_id=app.id, created_by=account_id, updated_by=account_id
            ).from_model_config_dict(cast(AppModelConfigDict, config))
            session.add(new_config)
            session.flush()
            app.app_model_config_id = new_config.id
            app.updated_by = account_id
            app.updated_at = naive_utc_now()
            app_model_config_was_updated.send(app, app_model_config=new_config, session=session)
