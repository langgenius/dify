"""Actor-conditioned published Agent metadata. Discovery performs no capability I/O."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import JsonValue
from sqlalchemy import Select, and_, case, distinct, func, or_, select
from sqlalchemy.orm import Session, aliased

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from models.agent import Agent, AgentConfigRevision, AgentConfigRevisionOperation, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from runtime_contracts.builder.execution import canonical_digest
from services.agent import access_service
from services.agent.roster_service import AgentRosterService


@dataclass(frozen=True)
class PublishedAgentCandidate:
    agent_id: str
    snapshot_id: str
    # None means native visible-history numbering is unavailable.
    display_version: int | None
    snapshot_version: int
    name: str
    description: str
    capability: str
    capability_source: Literal["published_snapshot.summary", "public_roster.description", "node_job_required"]
    dependencies: tuple[str, ...]
    input_schema: dict[str, JsonValue]
    output_schema: None
    input_contract_source: Literal["published_soul.app_variables"]
    output_contract_source: Literal["node_job_required"]
    capability_digest: str
    # Eligibility of returned actor-scoped catalog entries to be referenced;
    # this never asserts their internal tools/accounts can execute.
    reference_permitted: bool = True
    readiness: Literal["ready", "missing_config"] = "ready"

    @property
    def resource_id(self) -> str:
        """Opaque selection identity; the server revalidates all components on apply."""
        return f"agent:{self.agent_id}:{self.snapshot_id}:{self.capability_digest}"


def project_published_agent(
    *, agent: Agent, snapshot: AgentConfigSnapshot, display_version: int | None = None
) -> PublishedAgentCandidate:
    """Project public snapshot facts; only the catalog supplies visible-history numbering.

    Binding also uses this pure projection to compare capability digests without
    reading history, in which case a public display version is unknown.
    """
    if snapshot.tenant_id != agent.tenant_id or snapshot.agent_id != agent.id:
        raise ValueError("Agent snapshot owner mismatch")
    soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
    # Explicit allowlist: no prompt, defaults, runtime parameters, env, credential
    # references, hidden metadata or contact configuration enters planning.
    inputs: dict[str, JsonValue] = {
        item.name: {"type": item.type, "required": item.required} for item in soul.app_variables
    }
    dependencies = tuple(
        sorted(
            [
                f"tool:{item.provider_id or f'{item.plugin_id}/{item.provider}'}/{item.tool_name or '*'}"
                for item in soul.tools.dify_tools
                if item.enabled
            ]
            + [
                f"cli:{item.id or item.name or item.tool_name or item.label}"
                for item in soul.tools.cli_tools
                if item.enabled
            ]
            + (
                [f"model:{soul.model.plugin_id}/{soul.model.model_provider}/{soul.model.model}"]
                if soul.model is not None
                else []
            )
            + [f"knowledge:{dataset.id}" for item in soul.knowledge.sets for dataset in item.datasets if dataset.id]
        )
    )
    # Roster description is public catalog metadata, not a published Soul
    # contract. Keep its provenance explicit when no snapshot summary exists.
    description = snapshot.summary or agent.description or ""
    capability = description or "Published Workspace Agent; caller must declare its node-job outputs."
    capability_source: Literal["published_snapshot.summary", "public_roster.description", "node_job_required"] = (
        "published_snapshot.summary"
        if snapshot.summary
        else "public_roster.description"
        if agent.description
        else "node_job_required"
    )
    digest = canonical_digest(
        {
            "agent_id": agent.id,
            "snapshot_id": snapshot.id,
            "inputs": inputs,
            "dependencies": list(dependencies),
            "description": description,
            "capability_source": capability_source,
            "output_contract_source": "node_job_required",
        }
    )
    return PublishedAgentCandidate(
        agent_id=agent.id,
        snapshot_id=snapshot.id,
        display_version=display_version,
        snapshot_version=snapshot.version,
        name=agent.name,
        description=description,
        capability=capability,
        capability_source=capability_source,
        dependencies=dependencies,
        input_schema=inputs,
        output_schema=None,
        input_contract_source="published_soul.app_variables",
        output_contract_source="node_job_required",
        capability_digest=digest,
        readiness="missing_config"
        if any(item.enabled and item.credential_type == "unauthorized" for item in soul.tools.dify_tools)
        else "ready",
    )


class AgentCatalogService:
    def __init__(self, session: Session):
        self.session = session

    def list_candidates(
        self, *, tenant_id: str, actor_id: str, app_id: str | None, query: str | None, page: int = 1, limit: int = 100
    ) -> list[PublishedAgentCandidate]:
        """Native invite eligibility and current actor visibility precede pagination.

        A source exception propagates: unavailable is different from no matches.
        app_id may be absent during Build's pre-app resource planning.
        """
        if page < 1 or not 1 <= limit <= 100:
            raise ValueError("Invalid Agent catalog pagination")
        stmt = self._eligible_agents_stmt(tenant_id=tenant_id, actor_id=actor_id, app_id=app_id, query=query)
        return self._project_candidates(tenant_id=tenant_id, stmt=stmt.offset((page - 1) * limit).limit(limit))

    def resolve_candidates(
        self, *, tenant_id: str, actor_id: str, app_id: str | None, agent_ids: frozenset[str]
    ) -> list[PublishedAgentCandidate]:
        """Revalidate only confirmed identities, independently of discovery page order.

        At most one recommendation page of explicitly requested IDs is resolved;
        this never enumerates the remaining workspace inventory. Active published
        snapshot and current access are reread; callers compare the confirmed
        snapshot/digest rather than silently adopting this current projection.
        """
        if not agent_ids or len(agent_ids) > 100:
            raise ValueError("Agent selection must contain between 1 and 100 identities")
        stmt = self._eligible_agents_stmt(tenant_id=tenant_id, actor_id=actor_id, app_id=app_id, query=None)
        return self._project_candidates(
            tenant_id=tenant_id, stmt=stmt.where(Agent.id.in_(agent_ids)).limit(len(agent_ids))
        )

    def _eligible_agents_stmt(
        self, *, tenant_id: str, actor_id: str, app_id: str | None, query: str | None
    ) -> Select[tuple[Agent]]:
        access = access_service.resolve_current_agent_access_filter(tenant_id=tenant_id, actor_id=actor_id)
        access_service.require_builder_agent_access(
            session=self.session, tenant_id=tenant_id, actor_id=actor_id, app_id=app_id
        )
        # Same native publication/model predicates as list_invite_options. Join the
        # snapshot by its complete owner chain, rather than its globally unique ID.
        stmt = AgentRosterService._build_roster_agents_stmt(tenant_id=tenant_id, keyword=query).where(
            Agent.active_config_has_model.is_(True), workflow_callable_active_snapshot_filter()
        )
        if access.accessible_agent_ids is not None:
            stmt = stmt.where(Agent.id.in_(access.accessible_agent_ids))
        return stmt

    def _project_candidates(self, *, tenant_id: str, stmt: Select[tuple[Agent]]) -> list[PublishedAgentCandidate]:
        agents = self.session.scalars(stmt).all()
        if not agents:
            return []
        snapshots = {
            snapshot.agent_id: snapshot
            for snapshot in self.session.scalars(
                select(AgentConfigSnapshot).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    or_(
                        *(
                            and_(
                                AgentConfigSnapshot.agent_id == agent.id,
                                AgentConfigSnapshot.id == agent.active_config_snapshot_id,
                            )
                            for agent in agents
                        )
                    ),
                )
            )
        }
        if len(snapshots) != len(agents):
            raise ValueError("Published Agent snapshot unavailable")
        display_versions = self._display_versions_by_snapshot_id(tenant_id=tenant_id, agents=agents)
        return [
            project_published_agent(
                agent=agent,
                snapshot=snapshots[agent.id],
                display_version=display_versions.get(snapshots[agent.id].id),
            )
            for agent in agents
        ]

    def _display_versions_by_snapshot_id(self, *, tenant_id: str, agents: Sequence[Agent]) -> dict[str, int]:
        """Native visible-snapshot rank in one bounded aggregate, without loading history.

        The roster API numbers distinct visible snapshots by snapshot revision,
        not publication audit entries. Count only visible snapshots at or before
        each active snapshot; a restored older version retains its original rank.
        Source-specific visibility remains owned by AgentRosterService.
        """
        operations_by_agents: dict[frozenset[AgentConfigRevisionOperation], list[str]] = {}
        for agent in agents:
            operations = frozenset(AgentRosterService._visible_version_operations(agent))
            operations_by_agents.setdefault(operations, []).append(agent.id)
        active = aliased(AgentConfigSnapshot)
        rows = self.session.execute(
            select(
                active.id,
                func.count(distinct(AgentConfigSnapshot.id)),
                func.max(case((AgentConfigSnapshot.id == active.id, 1), else_=0)),
            )
            .select_from(active)
            .join(
                AgentConfigSnapshot,
                and_(
                    AgentConfigSnapshot.tenant_id == active.tenant_id,
                    AgentConfigSnapshot.agent_id == active.agent_id,
                    AgentConfigSnapshot.version <= active.version,
                ),
            )
            .join(
                AgentConfigRevision,
                and_(
                    AgentConfigRevision.tenant_id == AgentConfigSnapshot.tenant_id,
                    AgentConfigRevision.agent_id == AgentConfigSnapshot.agent_id,
                    AgentConfigRevision.current_snapshot_id == AgentConfigSnapshot.id,
                ),
            )
            .where(
                active.tenant_id == tenant_id,
                or_(
                    *(
                        and_(active.agent_id == agent.id, active.id == agent.active_config_snapshot_id)
                        for agent in agents
                    )
                ),
                or_(
                    *(
                        and_(
                            AgentConfigSnapshot.agent_id.in_(agent_ids),
                            AgentConfigRevision.operation.in_(operations),
                        )
                        for operations, agent_ids in operations_by_agents.items()
                    )
                ),
            )
            .group_by(active.id)
        )
        return {snapshot_id: int(rank) for snapshot_id, rank, active_is_visible in rows if active_is_visible}
