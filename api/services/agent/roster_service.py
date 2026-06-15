from typing import Any, TypedDict

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from libs.datetime_utils import naive_utc_now
from libs.helper import to_timestamp
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.model import App
from models.workflow import Workflow
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentArchivedError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
)
from services.entities.agent_entities import RosterAgentCreatePayload, RosterAgentUpdatePayload


class AgentReferencingWorkflow(TypedDict):
    """A workflow app that references a roster Agent via an Agent node."""

    app_id: str
    app_name: str
    app_mode: str
    workflow_id: str
    workflow_version: str
    node_ids: list[str]


class AgentRosterService:
    def __init__(self, session: Any):
        self._session = session

    @staticmethod
    def serialize_agent(
        agent: Agent,
        active_version: AgentConfigSnapshot | None = None,
        published_references: list[AgentReferencingWorkflow] | None = None,
    ) -> dict[str, Any]:
        published_references = published_references or []
        return {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "role": agent.role or "",
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
            "archived_at": to_timestamp(agent.archived_at),
            "created_at": to_timestamp(agent.created_at),
            "updated_at": to_timestamp(agent.updated_at),
            "published_reference_count": len(published_references),
            "published_node_reference_count": sum(len(item["node_ids"]) for item in published_references),
            "published_references": published_references,
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
            "created_at": to_timestamp(version.created_at),
        }

    @staticmethod
    def _build_roster_agents_stmt(*, tenant_id: str, keyword: str | None = None):
        stmt = select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.status == AgentStatus.ACTIVE,
        )
        if keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(keyword)
            stmt = stmt.where(Agent.name.ilike(f"%{escaped_keyword}%", escape="\\"))
        return stmt.order_by(Agent.updated_at.desc())

    def list_roster_agents(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None
    ) -> dict[str, Any]:
        stmt = self._build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword)

        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )

        data = []
        for agent in agents:
            active_version = (
                versions_by_id.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None
            )
            data.append(
                self.serialize_agent(
                    agent,
                    active_version,
                    published_references_by_agent_id.get(agent.id, []),
                )
            )

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
        stmt = self._build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword).where(
            Agent.active_config_has_model.is_(True)
        )
        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        data = [
            self.serialize_agent(
                agent,
                versions_by_id.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None,
                published_references_by_agent_id.get(agent.id, []),
            )
            for agent in agents
        ]
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
                agent_ids = [item["id"] for item in data]
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

        for item in data:
            existing_node_ids = usage_by_agent_id.get(item["id"], [])
            item["is_in_current_workflow"] = bool(existing_node_ids)
            item["in_current_workflow_count"] = len(existing_node_ids)
            item["existing_node_ids"] = existing_node_ids
        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": page * limit < total,
        }

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
            role=payload.role,
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
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)

        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc
        return agent

    def create_backing_agent_for_app(
        self,
        *,
        tenant_id: str,
        account_id: str,
        app_id: str,
        name: str,
        description: str = "",
        icon_type: Any = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> Agent:
        """Create the roster Agent that backs an Agent App, linked via ``app_id``.

        Unlike :meth:`create_roster_agent`, this does not commit: the caller
        (``AppService.create_app``) owns the surrounding transaction so the App
        row and its backing Agent are persisted atomically. A default (empty)
        Agent Soul is seeded; the user configures model/prompt/tools afterward in
        the Composer.
        """
        agent = Agent(
            tenant_id=tenant_id,
            name=name,
            description=description,
            role="",
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id=app_id,
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
            config_snapshot=AgentSoulConfig(),
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
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(AgentSoulConfig())
        self._session.flush()
        return agent

    def get_app_backing_agent(self, *, tenant_id: str, app_id: str) -> Agent | None:
        """Return the roster Agent that backs the given Agent App, if any."""
        return self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.app_id == app_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source == AgentSource.AGENT_APP,
                Agent.status == AgentStatus.ACTIVE,
            )
        )

    def list_workflows_referencing_app_agent(self, *, tenant_id: str, app_id: str) -> list[AgentReferencingWorkflow]:
        """List the workflow apps that reference this Agent App's bound Agent.

        Read-only "Workflow access" surface: an Agent App is backed by a roster
        Agent, and workflow Agent nodes may bind that same roster Agent. This
        returns the distinct workflow apps (with the referencing node ids) so the
        console can show "used by" without exposing the workflow internals.
        """
        agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=app_id)
        if agent is None:
            return []

        return self._load_published_references_by_agent_id(tenant_id=tenant_id, agent_ids=[agent.id]).get(agent.id, [])

    def get_roster_agent_detail(self, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        active_version = self._get_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id],
        )
        return self.serialize_agent(agent, active_version, published_references_by_agent_id.get(agent.id, []))

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
                "created_at": to_timestamp(revision.created_at),
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

    def _load_published_references_by_agent_id(
        self, *, tenant_id: str, agent_ids: list[str]
    ) -> dict[str, list[AgentReferencingWorkflow]]:
        if not agent_ids:
            return {}

        bindings = list(
            self._session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                    WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
                    WorkflowAgentNodeBinding.workflow_version != Workflow.VERSION_DRAFT,
                )
            ).all()
        )
        if not bindings:
            return {}

        app_ids = {binding.app_id for binding in bindings}
        apps = {
            app.id: app
            for app in self._session.scalars(
                select(App).where(
                    App.tenant_id == tenant_id,
                    App.id.in_(app_ids),
                    App.status == AppStatus.NORMAL,
                )
            ).all()
        }

        grouped: dict[str, dict[tuple[str, str], AgentReferencingWorkflow]] = {}
        for binding in bindings:
            if not binding.agent_id:
                continue
            app = apps.get(binding.app_id)
            if app is None or app.workflow_id != binding.workflow_id:
                continue
            by_workflow = grouped.setdefault(binding.agent_id, {})
            key = (binding.app_id, binding.workflow_id)
            item = by_workflow.setdefault(
                key,
                AgentReferencingWorkflow(
                    app_id=binding.app_id,
                    app_name=app.name,
                    app_mode=str(app.mode),
                    workflow_id=binding.workflow_id,
                    workflow_version=binding.workflow_version,
                    node_ids=[],
                ),
            )
            item["node_ids"].append(binding.node_id)

        result: dict[str, list[AgentReferencingWorkflow]] = {}
        for agent_id, by_workflow in grouped.items():
            references = list(by_workflow.values())
            for reference in references:
                reference["node_ids"] = sorted(set(reference["node_ids"]))
            references.sort(key=lambda item: (item["app_name"].lower(), item["workflow_id"]))
            result[agent_id] = references
        return result

    def _load_versions_by_id(self, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
        if not version_ids:
            return {}
        versions = self._session.scalars(
            select(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(version_ids))
        ).all()
        return {version.id: version for version in versions}
