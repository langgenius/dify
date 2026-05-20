from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from libs.datetime_utils import naive_utc_now
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentNodeBinding,
)
from models.workflow import Workflow
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentArchivedError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
)
from services.entities.agent_entities import RosterAgentCreatePayload, RosterAgentUpdatePayload


class AgentRosterService:
    def __init__(self, session: Any):
        self._session = session

    @staticmethod
    def serialize_agent(agent: Agent, active_version: AgentConfigSnapshot | None = None) -> dict[str, Any]:
        return {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "icon_type": agent.icon_type.value if agent.icon_type else None,
            "icon": agent.icon,
            "icon_background": agent.icon_background,
            "agent_kind": agent.agent_kind.value,
            "scope": agent.scope.value,
            "source": agent.source.value,
            "app_id": agent.app_id,
            "workflow_id": agent.workflow_id,
            "workflow_node_id": agent.workflow_node_id,
            "active_config_snapshot_id": agent.active_config_snapshot_id,
            "active_config_snapshot": AgentRosterService.serialize_version(active_version) if active_version else None,
            "status": agent.status.value,
            "created_by": agent.created_by,
            "updated_by": agent.updated_by,
            "archived_by": agent.archived_by,
            "archived_at": agent.archived_at.isoformat() if agent.archived_at else None,
            "created_at": agent.created_at.isoformat() if agent.created_at else None,
            "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
        }

    @staticmethod
    def serialize_version(version: AgentConfigSnapshot | None) -> dict[str, Any] | None:
        if version is None:
            return None
        return {
            "id": version.id,
            "agent_id": version.agent_id,
            "version": version.version,
            "summary": version.summary,
            "version_note": version.version_note,
            "created_by": version.created_by,
            "created_at": version.created_at.isoformat() if version.created_at else None,
        }

    def list_roster_agents(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None
    ) -> dict[str, Any]:
        stmt = select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.status == AgentStatus.ACTIVE,
        )
        if keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(keyword)
            stmt = stmt.where(Agent.name.ilike(f"%{escaped_keyword}%", escape="\\"))
        stmt = stmt.order_by(Agent.updated_at.desc())

        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )

        data = []
        for agent in agents:
            active_version = (
                versions_by_id.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None
            )
            data.append(self.serialize_agent(agent, active_version))

        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": page * limit < total,
        }

    def list_invite_options(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None, app_id: str | None = None
    ) -> dict[str, Any]:
        result = self.list_roster_agents(tenant_id=tenant_id, page=page, limit=limit, keyword=keyword)
        usage_by_agent_id: dict[str, list[str]] = {}
        if app_id:
            draft_workflow = self._session.scalar(
                select(Workflow)
                .where(
                    Workflow.tenant_id == tenant_id,
                    Workflow.app_id == app_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
                .limit(1)
            )
            if draft_workflow:
                agent_ids = [item["id"] for item in result["data"]]
                if agent_ids:
                    bindings = self._session.scalars(
                        select(WorkflowAgentNodeBinding).where(
                            WorkflowAgentNodeBinding.tenant_id == tenant_id,
                            WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                            WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                        )
                    ).all()
                    for binding in bindings:
                        if binding.agent_id:
                            usage_by_agent_id.setdefault(binding.agent_id, []).append(binding.node_id)

        for item in result["data"]:
            existing_node_ids = usage_by_agent_id.get(item["id"], [])
            item["is_in_current_workflow"] = bool(existing_node_ids)
            item["in_current_workflow_count"] = len(existing_node_ids)
            item["existing_node_ids"] = existing_node_ids
        return result

    def create_roster_agent(
        self,
        *,
        tenant_id: str,
        account_id: str,
        payload: RosterAgentCreatePayload,
        source: AgentSource = AgentSource.AGENT_APP,
    ) -> Agent:
        ComposerConfigValidator.validate_agent_soul(payload.agent_soul)

        agent = Agent(
            tenant_id=tenant_id,
            name=payload.name,
            description=payload.description,
            icon_type=payload.icon_type,
            icon=payload.icon,
            icon_background=payload.icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=source,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        self._session.add(agent)
        try:
            self._session.flush()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=payload.agent_soul,
            version_note=payload.version_note,
            created_by=account_id,
        )
        self._session.add(version)
        self._session.flush()

        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=version.id,
            revision=1,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=payload.version_note,
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id

        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc
        return agent

    def get_roster_agent_detail(self, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        active_version = self._get_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        return self.serialize_agent(agent, active_version)

    def update_roster_agent(
        self, *, tenant_id: str, agent_id: str, account_id: str, payload: RosterAgentUpdatePayload
    ) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            raise AgentArchivedError()

        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(agent, key, value)
        agent.updated_by = account_id

        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc
        return self.get_roster_agent_detail(tenant_id=tenant_id, agent_id=agent_id)

    def archive_roster_agent(self, *, tenant_id: str, agent_id: str, account_id: str) -> None:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            return
        agent.status = AgentStatus.ARCHIVED
        agent.archived_by = account_id
        agent.archived_at = naive_utc_now()
        agent.updated_by = account_id
        self._session.commit()

    def list_agent_versions(self, *, tenant_id: str, agent_id: str) -> list[dict[str, Any]]:
        self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        versions = list(
            self._session.scalars(
                select(AgentConfigSnapshot)
                .where(AgentConfigSnapshot.tenant_id == tenant_id, AgentConfigSnapshot.agent_id == agent_id)
                .order_by(AgentConfigSnapshot.version.desc())
            ).all()
        )
        return [
            serialized_version
            for version in versions
            if (serialized_version := self.serialize_version(version)) is not None
        ]

    def get_agent_version_detail(self, *, tenant_id: str, agent_id: str, version_id: str) -> dict[str, Any]:
        self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        version = self._get_version(tenant_id=tenant_id, agent_id=agent_id, version_id=version_id)
        revisions = list(
            self._session.scalars(
                select(AgentConfigRevision)
                .where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                    AgentConfigRevision.current_snapshot_id == version_id,
                )
                .order_by(AgentConfigRevision.revision.desc())
            ).all()
        )
        result = self.serialize_version(version) or {}
        result["config_snapshot"] = version.config_snapshot_dict
        result["revisions"] = [
            {
                "id": revision.id,
                "previous_snapshot_id": revision.previous_snapshot_id,
                "current_snapshot_id": revision.current_snapshot_id,
                "revision": revision.revision,
                "operation": revision.operation.value,
                "summary": revision.summary,
                "version_note": revision.version_note,
                "created_by": revision.created_by,
                "created_at": revision.created_at.isoformat() if revision.created_at else None,
            }
            for revision in revisions
        ]
        return result

    def _get_agent(self, *, tenant_id: str, agent_id: str, roster_only: bool = False) -> Agent:
        stmt = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if roster_only:
            stmt = stmt.where(Agent.scope == AgentScope.ROSTER)
        agent = self._session.scalar(stmt.limit(1))
        if not agent:
            raise AgentNotFoundError()
        return agent

    def _get_version(self, *, tenant_id: str, agent_id: str, version_id: str | None) -> AgentConfigSnapshot:
        if not version_id:
            raise AgentVersionNotFoundError()
        version = self._session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
            )
            .limit(1)
        )
        if not version:
            raise AgentVersionNotFoundError()
        return version

    def _load_versions_by_id(self, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
        if not version_ids:
            return {}
        versions = self._session.scalars(
            select(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(version_ids))
        ).all()
        return {version.id: version for version in versions}
