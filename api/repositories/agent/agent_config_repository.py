"""Read exact Agent configuration versions inside their tenant and owner scope."""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from repositories.agent.agent_drafts import find_agent_snapshot
from services.agent.agent_config_contracts import AgentConfigSelection, AgentConfigVersionKind
from services.agent.config_assets_store import AgentConfigTarget, AgentConfigTargetError, AgentConfigTargetErrorCode


class AgentConfigRepository:
    def __init__(self, *, session_factory: Callable[[], Session]) -> None:
        """Use the supplied session factory for bounded reads of an exact version."""
        self._session_factory = session_factory

    def get_config_target(self, selection: AgentConfigSelection) -> AgentConfigTarget:
        """Load the exact version and validate its Soul before closing the read session."""
        with self._session_factory() as session:
            version = self.get_version_in_session(session, selection, for_update=False)
            return AgentConfigTarget(
                tenant_id=selection.tenant_id,
                agent_id=selection.agent_id,
                version_id=version.id,
                kind=selection.version_kind,
                writable=selection.version_kind == AgentConfigVersionKind.BUILD_DRAFT,
                agent_soul=AgentSoulConfig.model_validate(version.config_snapshot_dict).model_copy(deep=True),
            )

    @staticmethod
    def get_version_in_session(
        session: Session, selection: AgentConfigSelection, *, for_update: bool
    ) -> AgentConfigSnapshot | AgentConfigDraft:
        """Load the owned version in the caller's session, locking Agent before Draft for legacy writes.

        Refresh cached Draft state under the lock. A snapshot remains read-only.
        The caller owns any commit and the lifetime of the returned ORM row.
        """
        agent_query = select(Agent).where(Agent.id == selection.agent_id, Agent.tenant_id == selection.tenant_id)
        if for_update:
            agent_query = agent_query.with_for_update().execution_options(populate_existing=True)
        try:
            agent = session.scalar(agent_query.execution_options(autoflush=False))
        except SQLAlchemyError as exc:
            session.rollback()
            raise AgentConfigTargetError(
                AgentConfigTargetErrorCode.AGENT_NOT_FOUND, "agent does not belong to this tenant"
            ) from exc
        if agent is None:
            raise AgentConfigTargetError(
                AgentConfigTargetErrorCode.AGENT_NOT_FOUND, "agent does not belong to this tenant"
            )

        try:
            with session.no_autoflush:
                version = AgentConfigRepository._find_version(session, selection, for_update=for_update)
        except SQLAlchemyError as exc:
            session.rollback()
            raise AgentConfigTargetError(
                AgentConfigTargetErrorCode.VERSION_NOT_FOUND, "agent config version was not found"
            ) from exc
        if version is None:
            raise AgentConfigTargetError(
                AgentConfigTargetErrorCode.VERSION_NOT_FOUND, "agent config version was not found"
            )
        return version

    @staticmethod
    def _find_version(
        session: Session, selection: AgentConfigSelection, *, for_update: bool
    ) -> AgentConfigSnapshot | AgentConfigDraft | None:
        """Match the explicit version and kind, requiring the personal Build account where applicable."""
        match selection.version_kind:
            case AgentConfigVersionKind.SNAPSHOT:
                return find_agent_snapshot(
                    session=session,
                    tenant_id=selection.tenant_id,
                    agent_id=selection.agent_id,
                    version_id=selection.version_id,
                )
            case AgentConfigVersionKind.DRAFT:
                draft_type = AgentConfigDraftType.DRAFT
                account_id = None
            case AgentConfigVersionKind.BUILD_DRAFT:
                if not selection.account_id:
                    raise AgentConfigTargetError(
                        AgentConfigTargetErrorCode.MISSING_USER_ID, "user_id is required for build draft config access"
                    )
                draft_type = AgentConfigDraftType.DEBUG_BUILD
                account_id = selection.account_id
            case _:
                raise AgentConfigTargetError(
                    AgentConfigTargetErrorCode.INVALID_VERSION_KIND, "unsupported config version kind"
                )

        query = select(AgentConfigDraft).where(
            AgentConfigDraft.tenant_id == selection.tenant_id,
            AgentConfigDraft.agent_id == selection.agent_id,
            AgentConfigDraft.id == selection.version_id,
            AgentConfigDraft.draft_type == draft_type,
            AgentConfigDraft.account_id == account_id,
        )
        if for_update:
            query = query.with_for_update().execution_options(populate_existing=True, autoflush=False)
        return session.scalar(query)
