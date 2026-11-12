"""Live owned Test file reads for scoped preview issuance and delivery checks."""

from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.external_agent import ExternalAgentFileLease, ExternalAgentInvocation
from models.model import UploadFile
from services.external_agents.contracts import ExternalAgentConflictError, ExternalAgentNotFoundError
from services.external_agents.io_contracts import ExternalIOError, FileScope
from services.external_agents.test_file_access import AuthorizedTestFile, TestFileGrant

from .asset_repository import ExternalAssetRepository, utc_time
from .file_lifecycle_repository import ExternalFileLifecycleRepository
from .test_file_repository import ExternalTestFileRepository


def _published_file(value: object, file_id: str) -> bool:
    """Find an actual published File marker, never an arbitrary matching string."""
    if isinstance(value, dict):
        return (value.get("dify_model_identity") == "__dify__file__" and value.get("upload_file_id") == file_id) or any(
            _published_file(item, file_id) for item in value.values()
        )
    return isinstance(value, list) and any(_published_file(item, file_id) for item in value)


class ExternalTestFileAccessRepository:
    def __init__(self, *, sessions: sessionmaker[Session], clock: Callable[[], datetime]) -> None:
        self._sessions, self._clock = sessions, clock

    @staticmethod
    def _page(session: Session, context: RequestContext, agent_id: str, page: str, generation: int | None) -> int:
        ExternalAssetRepository._writer_role(session, context, allowed_roles=frozenset({"owner", "admin", "editor"}))
        _, head = ExternalAssetRepository._rows(session, context.active_workspace_id, agent_id)
        if generation is not None and generation != head.test_display_generation:
            raise ExternalAgentConflictError("The Test display generation changed.")
        ExternalTestFileRepository._page(session, context, page)
        return head.test_display_generation

    @staticmethod
    def _invocation(
        session: Session, context: RequestContext, agent_id: str, page: str, invocation_id: str
    ) -> ExternalAgentInvocation:
        try:
            row = ExternalFileLifecycleRepository._owned(
                session,
                FileScope(
                    tenant_id=context.active_workspace_id,
                    actor_id=context.account_id,
                    app_id=None,
                    invocation_id=invocation_id,
                ),
            )
        except ExternalIOError as error:
            raise ExternalAgentNotFoundError("The Test file source is absent or expired.") from error
        if row.agent_id != agent_id or row.job_config.get("page_session_id") != page:
            raise ExternalAgentNotFoundError("The Test file source does not belong to this page.")
        return row

    @staticmethod
    def _upload(session: Session, context: RequestContext, file_id: str) -> None:
        if (
            session.scalar(
                select(UploadFile.id).where(
                    UploadFile.id == file_id,
                    UploadFile.tenant_id == context.active_workspace_id,
                    UploadFile.created_by == context.account_id,
                    UploadFile.created_by_role == "account",
                )
            )
            is None
        ):
            raise ExternalAgentNotFoundError("The owned Test upload is absent.")

    def input_file(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int | None,
        lease_id: str,
    ) -> AuthorizedTestFile:
        """Read a live input in the current page; retained input may span metadata edits.

        Full source owner/lifecycle remains checked when the input was submitted,
        while a new grant pins the current generation rather than its old run's.
        No connection, storage handle or SQL object crosses this short read.
        """
        current = self._clock().astimezone(UTC).replace(tzinfo=None)
        with self._sessions() as session:
            generation = self._page(session, context, agent_id, page_session_id, expected_generation)
            lease = session.scalar(
                select(ExternalAgentFileLease).where(
                    ExternalAgentFileLease.id == lease_id,
                    ExternalAgentFileLease.tenant_id == context.active_workspace_id,
                    ExternalAgentFileLease.owner_id == context.account_id,
                    ExternalAgentFileLease.agent_id == agent_id,
                    ExternalAgentFileLease.page_session_id == page_session_id,
                    ExternalAgentFileLease.purpose == "input",
                    ExternalAgentFileLease.write_state == "committed",
                    ExternalAgentFileLease.released_at.is_(None),
                    ExternalAgentFileLease.expires_at > current,
                )
            )
            if lease is None:
                raise ExternalAgentNotFoundError("The Test input lease is absent or expired.")
            expiry = lease.expires_at
            if lease.invocation_id is not None:
                source = self._invocation(session, context, agent_id, page_session_id, lease.invocation_id)
                expiry = min(
                    [expiry, *(v for v in (source.test_expires_at, source.retention_expires_at) if v is not None)]
                )
            self._upload(session, context, lease.file_id)
            return AuthorizedTestFile(
                grant=TestFileGrant(
                    kind="input",
                    tenant_id=context.active_workspace_id,
                    actor_id=context.account_id,
                    agent_id=agent_id,
                    page_session_id=page_session_id,
                    expected_generation=generation,
                    resource_id=lease.id,
                    file_id=lease.file_id,
                ),
                expires_at=utc_time(expiry),
            )

    def output_page(self, context: RequestContext, *, agent_id: str, invocation_id: str) -> tuple[str, int]:
        """Recover current result page from the exact persisted owned Invocation."""
        with self._sessions() as session:
            page = self._source_page(session, context, invocation_id)
            source = self._invocation(session, context, agent_id, page, invocation_id)
            generation = self._page(session, context, agent_id, page, source.test_generation)
            if source.test_generation is None or generation != source.test_generation:
                raise ExternalAgentConflictError("The Test result belongs to an earlier generation.")
            return page, generation

    @staticmethod
    def _source_page(session: Session, context: RequestContext, invocation_id: str) -> str:
        row = session.scalar(
            select(ExternalAgentInvocation).where(
                ExternalAgentInvocation.id == invocation_id,
                ExternalAgentInvocation.tenant_id == context.active_workspace_id,
                ExternalAgentInvocation.initiator_id == context.account_id,
                ExternalAgentInvocation.origin == "overview_test",
                ExternalAgentInvocation.app_id.is_(None),
            )
        )
        page = row.job_config.get("page_session_id") if row else None
        if not isinstance(page, str):
            raise ExternalAgentNotFoundError("The Overview Test source is absent.")
        return page

    def output_file(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int,
        invocation_id: str,
        file_id: str,
    ) -> AuthorizedTestFile:
        """Read only a live committed lease for a File actually published by this result."""
        current = self._clock().astimezone(UTC).replace(tzinfo=None)
        with self._sessions() as session:
            generation = self._page(session, context, agent_id, page_session_id, expected_generation)
            source = self._invocation(session, context, agent_id, page_session_id, invocation_id)
            if source.test_generation != generation:
                raise ExternalAgentConflictError("The Test result belongs to an earlier generation.")
            lease = session.scalar(
                select(ExternalAgentFileLease).where(
                    ExternalAgentFileLease.tenant_id == context.active_workspace_id,
                    ExternalAgentFileLease.owner_id == context.account_id,
                    ExternalAgentFileLease.agent_id == agent_id,
                    ExternalAgentFileLease.page_session_id == page_session_id,
                    ExternalAgentFileLease.invocation_id == invocation_id,
                    ExternalAgentFileLease.file_id == file_id,
                    ExternalAgentFileLease.purpose == "output",
                    ExternalAgentFileLease.write_state == "committed",
                    ExternalAgentFileLease.released_at.is_(None),
                    ExternalAgentFileLease.expires_at > current,
                )
            )
            if lease is None or not _published_file(source.outputs, file_id):
                raise ExternalAgentNotFoundError("The published Test output file is absent or expired.")
            self._upload(session, context, file_id)
            expiry = min(
                [lease.expires_at, *(v for v in (source.test_expires_at, source.retention_expires_at) if v is not None)]
            )
            return AuthorizedTestFile(
                grant=TestFileGrant(
                    kind="output",
                    tenant_id=context.active_workspace_id,
                    actor_id=context.account_id,
                    agent_id=agent_id,
                    page_session_id=page_session_id,
                    expected_generation=generation,
                    resource_id=invocation_id,
                    file_id=file_id,
                ),
                expires_at=utc_time(expiry),
            )
