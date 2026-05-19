import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.agent import (
    Agent,
    AgentConfigVersion,
    AgentConfigVersionOperation,
    AgentConfigVersionRevision,
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


def _json_dump(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class AgentRosterService:
    @staticmethod
    def serialize_agent(agent: Agent, active_version: AgentConfigVersion | None = None) -> dict[str, Any]:
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
            "active_config_version_id": agent.active_config_version_id,
            "active_config_version": AgentRosterService.serialize_version(active_version) if active_version else None,
            "status": agent.status.value,
            "created_by": agent.created_by,
            "updated_by": agent.updated_by,
            "archived_by": agent.archived_by,
            "archived_at": agent.archived_at.isoformat() if agent.archived_at else None,
            "created_at": agent.created_at.isoformat() if agent.created_at else None,
            "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
        }

    @staticmethod
    def serialize_version(version: AgentConfigVersion | None) -> dict[str, Any] | None:
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

    @classmethod
    def list_roster_agents(
        cls, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None
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

        total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(db.session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = cls._load_versions_by_id(
            [agent.active_config_version_id for agent in agents if agent.active_config_version_id]
        )

        data = []
        for agent in agents:
            active_version = (
                versions_by_id.get(agent.active_config_version_id) if agent.active_config_version_id else None
            )
            data.append(cls.serialize_agent(agent, active_version))

        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": page * limit < total,
        }

    @classmethod
    def list_invite_options(
        cls, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None, app_id: str | None = None
    ) -> dict[str, Any]:
        result = cls.list_roster_agents(tenant_id=tenant_id, page=page, limit=limit, keyword=keyword)
        usage_by_agent_id: dict[str, list[str]] = {}
        if app_id:
            draft_workflow = db.session.scalar(
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
                    bindings = db.session.scalars(
                        select(WorkflowAgentNodeBinding).where(
                            WorkflowAgentNodeBinding.tenant_id == tenant_id,
                            WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                            WorkflowAgentNodeBinding.workflow_version == Workflow.VERSION_DRAFT,
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

    @classmethod
    def create_roster_agent(
        cls,
        *,
        tenant_id: str,
        account_id: str,
        payload: RosterAgentCreatePayload,
        source: AgentSource = AgentSource.AGENT_APP,
    ) -> Agent:
        ComposerConfigValidator.validate_agent_soul(payload.agent_soul)
        snapshot = _json_dump(payload.agent_soul.model_dump(mode="json"))

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
        db.session.add(agent)
        try:
            db.session.flush()
        except IntegrityError as exc:
            db.session.rollback()
            raise AgentNameConflictError() from exc

        version = AgentConfigVersion(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=snapshot,
            version_note=payload.version_note,
            created_by=account_id,
        )
        db.session.add(version)
        db.session.flush()

        revision = AgentConfigVersionRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            agent_config_version_id=version.id,
            revision=1,
            operation=AgentConfigVersionOperation.CREATE_VERSION,
            config_snapshot=snapshot,
            version_note=payload.version_note,
            created_by=account_id,
        )
        db.session.add(revision)
        agent.active_config_version_id = version.id

        try:
            db.session.commit()
        except IntegrityError as exc:
            db.session.rollback()
            raise AgentNameConflictError() from exc
        return agent

    @classmethod
    def get_roster_agent_detail(cls, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = cls._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        active_version = cls._get_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_version_id
        )
        return cls.serialize_agent(agent, active_version)

    @classmethod
    def update_roster_agent(
        cls, *, tenant_id: str, agent_id: str, account_id: str, payload: RosterAgentUpdatePayload
    ) -> dict[str, Any]:
        agent = cls._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            raise AgentArchivedError()

        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(agent, key, value)
        agent.updated_by = account_id

        try:
            db.session.commit()
        except IntegrityError as exc:
            db.session.rollback()
            raise AgentNameConflictError() from exc
        return cls.get_roster_agent_detail(tenant_id=tenant_id, agent_id=agent_id)

    @classmethod
    def archive_roster_agent(cls, *, tenant_id: str, agent_id: str, account_id: str) -> None:
        agent = cls._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            return
        agent.status = AgentStatus.ARCHIVED
        agent.archived_by = account_id
        agent.archived_at = naive_utc_now()
        agent.updated_by = account_id
        db.session.commit()

    @classmethod
    def list_agent_versions(cls, *, tenant_id: str, agent_id: str) -> list[dict[str, Any]]:
        cls._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        versions = list(
            db.session.scalars(
                select(AgentConfigVersion)
                .where(AgentConfigVersion.tenant_id == tenant_id, AgentConfigVersion.agent_id == agent_id)
                .order_by(AgentConfigVersion.version.desc())
            ).all()
        )
        return [
            serialized_version
            for version in versions
            if (serialized_version := cls.serialize_version(version)) is not None
        ]

    @classmethod
    def get_agent_version_detail(cls, *, tenant_id: str, agent_id: str, version_id: str) -> dict[str, Any]:
        cls._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        version = cls._get_version(tenant_id=tenant_id, agent_id=agent_id, version_id=version_id)
        revisions = list(
            db.session.scalars(
                select(AgentConfigVersionRevision)
                .where(
                    AgentConfigVersionRevision.tenant_id == tenant_id,
                    AgentConfigVersionRevision.agent_id == agent_id,
                    AgentConfigVersionRevision.agent_config_version_id == version_id,
                )
                .order_by(AgentConfigVersionRevision.revision.desc())
            ).all()
        )
        result = cls.serialize_version(version) or {}
        result["config_snapshot"] = version.config_snapshot_dict
        result["revisions"] = [
            {
                "id": revision.id,
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

    @classmethod
    def _get_agent(cls, *, tenant_id: str, agent_id: str, roster_only: bool = False) -> Agent:
        stmt = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if roster_only:
            stmt = stmt.where(Agent.scope == AgentScope.ROSTER)
        agent = db.session.scalar(stmt.limit(1))
        if not agent:
            raise AgentNotFoundError()
        return agent

    @classmethod
    def _get_version(cls, *, tenant_id: str, agent_id: str, version_id: str | None) -> AgentConfigVersion:
        if not version_id:
            raise AgentVersionNotFoundError()
        version = db.session.scalar(
            select(AgentConfigVersion)
            .where(
                AgentConfigVersion.tenant_id == tenant_id,
                AgentConfigVersion.agent_id == agent_id,
                AgentConfigVersion.id == version_id,
            )
            .limit(1)
        )
        if not version:
            raise AgentVersionNotFoundError()
        return version

    @classmethod
    def _load_versions_by_id(cls, version_ids: list[str]) -> dict[str, AgentConfigVersion]:
        if not version_ids:
            return {}
        versions = db.session.scalars(select(AgentConfigVersion).where(AgentConfigVersion.id.in_(version_ids))).all()
        return {version.id: version for version in versions}
