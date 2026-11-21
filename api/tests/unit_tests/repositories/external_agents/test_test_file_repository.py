"""Real lease reuse must preserve ownership metadata and page byte admission."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.external_agent import ExternalAgentFileLease
from repositories.external_agents.runtime_repository import ExternalRuntimeRepository
from repositories.external_agents.test_file_repository import ExternalTestFileRepository
from services.external_agents.contracts import ExternalAgentConflictError
from services.external_agents.file_profile import FileLimits
from services.external_agents.io_contracts import FileBlob, FileWriteReservation, JsonObject
from services.external_agents.runtime_contracts import CancelState, LocalState, RuntimeScope
from services.external_agents.test_service import TestFile as ExternalTestFile
from tests.unit_tests.repositories.external_agents.test_runtime_repository import domain, draft, uid

__all__ = ["domain"]

type RuntimeDomain = tuple[ExternalRuntimeRepository, sessionmaker[Session], RuntimeScope, str, str]


def test_reused_input_lease_preserves_metadata_and_input_budget_is_per_submission(domain: RuntimeDomain) -> None:
    runtime, sessions, scope, agent, _revision = domain
    context = RequestContext("test", None, scope.initiator_id, scope.tenant_id)
    files = ExternalTestFileRepository(sessions=sessions, limits=FileLimits(max_total_bytes=6))
    plan = FileWriteReservation(file_id=uid(), storage_key="owned-key")
    uploaded = files.register(
        context,
        agent_id=agent,
        page_session_id="page",
        plan=plan,
        blob=FileBlob(filename="one.txt", media_type="text/plain", data=b"four"),
    )
    assert files.complete(context, lease_id=uploaded.lease_id)
    parts: tuple[JsonObject, ...] = ({"text": "Task"}, {"fileRef": {"file_id": plan.file_id, "kind": "upload"}})
    job: JsonObject = {"page_session_id": "page", "input_lease_ids": [uploaded.lease_id]}
    first = runtime.create(scope, draft(agent, parts=parts, job=job), now=datetime.now(UTC))
    second = runtime.create(scope, draft(agent, parts=parts, job=job), now=datetime.now(UTC))
    with sessions() as session:
        leases = tuple(session.scalars(select(ExternalAgentFileLease)))
        assert len(leases) == 2
        assert {lease.invocation_id for lease in leases} == {first.id, second.id}
        assert all(lease.size == 4 for lease in leases)
        assert all(lease.media_type == "text/plain" for lease in leases)
        assert all(lease.file_value == {"filename": "one.txt"} for lease in leases)
    replacement = files.register(
        context,
        agent_id=agent,
        page_session_id="page",
        plan=FileWriteReservation(file_id=uid(), storage_key="second-key"),
        blob=FileBlob(filename="two.txt", media_type="text/plain", data=b"four"),
    )
    assert files.complete(context, lease_id=replacement.lease_id)
    with pytest.raises(ExternalAgentConflictError, match="byte budget"):
        files.references(
            context, agent_id=agent, page_session_id="page", lease_ids=(uploaded.lease_id, replacement.lease_id)
        )


def test_quota_uses_max_size_even_for_existing_metadata_incomplete_child_rows(domain: RuntimeDomain) -> None:
    _runtime, sessions, scope, agent, _revision = domain
    context = RequestContext("test", None, scope.initiator_id, scope.tenant_id)
    files = ExternalTestFileRepository(sessions=sessions, limits=FileLimits(max_total_bytes=6))
    file_id = uid()
    with sessions.begin() as session:
        for size in (4, None):
            session.add(
                ExternalAgentFileLease(
                    id=uid(),
                    tenant_id=scope.tenant_id,
                    file_id=file_id,
                    owner_id=scope.initiator_id,
                    purpose="input",
                    expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
                    agent_id=agent,
                    page_session_id="page",
                    size=size,
                    write_state="committed",
                )
            )
    with pytest.raises(ExternalAgentConflictError):
        files.register(
            context,
            agent_id=agent,
            page_session_id="page",
            plan=FileWriteReservation(file_id=uid(), storage_key="second-key"),
            blob=FileBlob(filename="two.txt", media_type="text/plain", data=b"four"),
        )


def test_clear_unsubmitted_input_is_owned_idempotent_and_allows_replacement(domain: RuntimeDomain) -> None:
    _runtime, sessions, scope, agent, _revision = domain
    context = RequestContext("test", None, scope.initiator_id, scope.tenant_id)
    files = ExternalTestFileRepository(sessions=sessions, limits=FileLimits(max_total_bytes=6))

    def upload() -> ExternalTestFile:
        value = files.register(
            context,
            agent_id=agent,
            page_session_id="page",
            plan=FileWriteReservation(file_id=uid(), storage_key="owned-key"),
            blob=FileBlob(filename="one.txt", media_type="text/plain", data=b"four"),
        )
        assert files.complete(context, lease_id=value.lease_id)
        return value

    first = upload()
    files.release(context._replace(account_id=uid()), agent_id=agent, lease_id=first.lease_id)
    files.release(context._replace(active_workspace_id=uid()), agent_id=agent, lease_id=first.lease_id)
    files.release(context, agent_id=uid(), lease_id=first.lease_id)
    with sessions() as session:
        first_lease = session.get(ExternalAgentFileLease, first.lease_id)
        assert first_lease is not None
        assert first_lease.released_at is None
    with pytest.raises(ExternalAgentConflictError):
        upload()
    files.release(context, agent_id=agent, lease_id=first.lease_id)
    files.release(context, agent_id=agent, lease_id=first.lease_id)
    replacement = upload()
    assert replacement.lease_id != first.lease_id


def test_clear_submitted_input_preserves_inflight_and_confirmed_retry_file_ownership(domain: RuntimeDomain) -> None:
    runtime, sessions, scope, agent, _revision = domain
    context = RequestContext("test", None, scope.initiator_id, scope.tenant_id)
    files = ExternalTestFileRepository(sessions=sessions, limits=FileLimits())
    plan = FileWriteReservation(file_id=uid(), storage_key="owned-key")
    uploaded = files.register(
        context,
        agent_id=agent,
        page_session_id="page",
        plan=plan,
        blob=FileBlob(filename="one.txt", media_type="text/plain", data=b"four"),
    )
    assert files.complete(context, lease_id=uploaded.lease_id)
    request = draft(
        agent,
        parts=({"text": "Task"}, {"fileRef": {"file_id": plan.file_id, "kind": "upload"}}),
        job={"page_session_id": "page", "input_lease_ids": [uploaded.lease_id]},
    )
    value = runtime.create(scope, request, now=datetime.now(UTC))
    files.release(context, agent_id=agent, lease_id=uploaded.lease_id)
    with sessions() as session:
        original = session.get(ExternalAgentFileLease, uploaded.lease_id)
        assert original is not None
        assert original.invocation_id == value.id
        assert original.released_at is None
    proven = replace(
        value,
        cancel_state=CancelState.CONFIRMED,
        local_state=LocalState.RETRY_PENDING,
        remote_state="canceled",
        version=value.version + 1,
    )
    assert runtime.save(scope, value, proven)
    retried = runtime.create_retry(
        scope,
        proven,
        replace(request, invocation_id=uid(), message_id=uid(), sequence=1, retry_of=value.id),
        now=datetime.now(UTC),
    )
    assert retried.retry_of == value.id
    with sessions() as session:
        bound = tuple(session.scalars(select(ExternalAgentFileLease)))
        assert len(bound) == 2
        assert all(row.released_at is None and row.size == 4 for row in bound)
