"""Read and edit Agent configuration inside its exact tenant and owner scope."""

from collections.abc import Callable, Generator
from contextlib import contextmanager

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from models.model import UploadFile
from repositories.agent.agent_drafts import find_agent_snapshot
from repositories.file_grant_repository import find_file_row
from services.agent.agent_config_contracts import AgentConfigSelection, AgentConfigVersionKind
from services.agent.config_assets_store import (
    AgentConfigEdit,
    AgentConfigFileSource,
    AgentConfigFileSourceError,
    AgentConfigTarget,
    AgentConfigTargetError,
    AgentConfigTargetErrorCode,
)
from services.entities.file_grant_entities import FileKind


def _config_target(
    selection: AgentConfigSelection, version: AgentConfigDraft | AgentConfigSnapshot
) -> AgentConfigTarget:
    """Validate and copy the loaded version's Soul before leaving its session."""
    return AgentConfigTarget(
        tenant_id=selection.tenant_id,
        agent_id=selection.agent_id,
        version_id=version.id,
        kind=selection.version_kind,
        writable=selection.version_kind == AgentConfigVersionKind.BUILD_DRAFT,
        agent_soul=AgentSoulConfig.model_validate(version.config_snapshot_dict).model_copy(deep=True),
    )


class AgentConfigRepository:
    """Own short reads and single-commit edits for exact Agent config versions."""

    def __init__(self, *, session_factory: Callable[[], Session]) -> None:
        """Use the supplied session factory to load and persist one exact version at a time."""
        self._session_factory = session_factory

    def get_config_target(self, selection: AgentConfigSelection) -> AgentConfigTarget:
        """Load the exact version and validate its Soul before closing the read session."""
        with self._session_factory() as session:
            version = self._get_version_in_session(session, selection, for_update=False)
            return _config_target(selection, version)

    @contextmanager
    def edit_config(self, selection: AgentConfigSelection) -> Generator[AgentConfigEdit]:
        """Scope all lookups and any draft write to one session that closes on exit.

        Commit once after a successful edit that locked a target. Close without
        committing on a source-only lookup or an exception.
        """
        with self._session_factory() as session:
            edit = _AgentConfigEdit(session, selection)
            yield edit
            edit.commit()

    @staticmethod
    def _get_version_in_session(
        session: Session, selection: AgentConfigSelection, *, for_update: bool
    ) -> AgentConfigSnapshot | AgentConfigDraft:
        """Load the exact owned version, locking the Agent before its Draft for writes.

        Refresh cached Draft state under the lock. Return the row for use in
        the same session or raise AgentConfigTargetError.
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


class _AgentConfigEdit:
    """Keep the locked ORM version private and expose only copied data to the use case."""

    def __init__(self, session: Session, selection: AgentConfigSelection) -> None:
        """Use the repository's open session and defer locking until the use case selects its target."""
        self._session = session
        self._selection = selection
        self._locked: tuple[AgentConfigDraft | AgentConfigSnapshot, AgentConfigTarget] | None = None

    def lock_target(self) -> AgentConfigTarget:
        """Lock and refresh the selected version once, then reuse the same detached target."""
        if self._locked is None:
            version = AgentConfigRepository._get_version_in_session(self._session, self._selection, for_update=True)
            self._locked = version, _config_target(self._selection, version)
        return self._locked[1]

    def get_file_source(self, *, file_id: str, kind: FileKind) -> AgentConfigFileSource | None:
        """Read one source in the selected workspace without flushing or locking the draft."""
        try:
            with self._session.no_autoflush:
                row = find_file_row(self._session, file_id=file_id, kind=kind, tenant_id=self._selection.tenant_id)
        except SQLAlchemyError as exc:
            raise AgentConfigFileSourceError("Could not read the Agent config file source") from exc
        if row is None:
            return None
        if isinstance(row, UploadFile):
            return AgentConfigFileSource(
                id=row.id,
                name=row.name,
                storage_key=row.key,
                size=row.size,
                mime_type=row.mime_type,
                hash=row.hash,
            )
        return AgentConfigFileSource(
            id=row.id,
            name=row.name,
            storage_key=row.file_key,
            size=row.size,
            mime_type=row.mimetype,
            hash=None,
        )

    def commit(self) -> None:
        """Persist the edited Soul after a successful use case, keeping snapshots immutable."""
        if self._locked is None:
            return
        version, target = self._locked
        if not isinstance(version, AgentConfigDraft):
            raise RuntimeError("Cannot commit an edit to an Agent config snapshot")
        version.config_snapshot = target.agent_soul
        self._session.commit()
