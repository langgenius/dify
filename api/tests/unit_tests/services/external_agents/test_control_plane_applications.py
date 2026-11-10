"""Control-plane behavior over actual scoped SQL repositories and typed IO ports.

These tests cross application/repository boundaries: proof consumption, immutable
connection revisions, display generations, file intents and Invocation commands
are persisted. The only deterministic ports replace external secret/network/blob
IO; they never fabricate ORM construction or bypass an application constructor.
"""

import copy
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Literal, override

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import WorkflowAgentNodeBinding
from models.base import TypeBase
from models.external_agent import (
    ExternalAgentFileLease,
    ExternalAgentHead,
    ExternalAgentInvocation,
    ExternalAgentOperation,
    ExternalAgentVerification,
)
from models.external_agent_trace import ExternalAgentDataTombstone
from models.workflow import Workflow
from repositories.external_agents.asset_repository import ExternalAssetRepository
from repositories.external_agents.test_file_repository import ExternalTestFileRepository
from services.external_agents.asset_service import ExternalAssetService
from services.external_agents.contracts import (
    ExternalAgentConflictError,
    ExternalAgentForbiddenError,
    ExternalAgentIdempotencyConflictError,
    ExternalAgentInvalidInputError,
    ExternalAgentLimits,
    ExternalAgentNotFoundError,
    ExternalAgentVerificationFailedError,
    OperationResult,
    VerificationEvidence,
)
from services.external_agents.file_profile import FileLimits
from services.external_agents.invocation_service import ExternalInvocationService
from services.external_agents.io_contracts import (
    ExternalIOError,
    FileBlob,
    FileWriteReservation,
    JsonObject,
    OutputField,
)
from services.external_agents.protocol import TRACEABILITY_URI, ConnectionSpec, GatewayError, VerificationResult
from services.external_agents.runtime_contracts import CancelState, Invocation, LocalState, WaitPolicy
from services.external_agents.test_service import ExternalTestService
from tests.unit_tests.repositories.external_agents.test_runtime_repository import (
    Clock,
    Domain,
    RemoteAgent,
    bound_engine,
    command,
    domain,
    stored,
    uid,
)
from tests.unit_tests.repositories.external_agents.test_runtime_repository import (
    service as runtime_service,
)

__all__ = ["domain"]


class MembershipAccess:
    """Resolve actual SQL membership; explicit visibility is a trusted policy result."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions
        self.visibility: frozenset[str] | None = None
        self.reference_ids: frozenset[str] = frozenset()

    def role(self, context: RequestContext) -> str | None:
        with self.sessions() as session:
            role = session.scalar(
                select(TenantAccountJoin.role).where(
                    TenantAccountJoin.tenant_id == context.active_workspace_id,
                    TenantAccountJoin.account_id == context.account_id,
                )
            )
            return str(role) if role is not None else None

    def visible_agent_ids(self, context: RequestContext) -> frozenset[str] | None:
        assert context.account_id
        return self.visibility

    def reference_app_ids(self, context: RequestContext, agent_id: str) -> frozenset[str]:
        assert self.role(context) in {"owner", "admin", "editor"}
        assert agent_id
        return self.reference_ids


class TenantSecrets:
    """Opaque tenant-owned values; changing the plaintext produces a new revision."""

    def __init__(self) -> None:
        self.values: dict[str, tuple[str, str]] = {}

    def encrypt(self, tenant_id: str, plaintext: str) -> str:
        sealed = "sealed-" + uid()
        self.values[sealed] = (tenant_id, plaintext)
        return sealed

    def decrypt(self, tenant_id: str, ciphertext: str) -> str:
        owner, value = self.values[ciphertext]
        assert owner == tenant_id
        return value

    def matches(self, tenant_id: str, ciphertext: str, plaintext: str) -> bool:
        return self.decrypt(tenant_id, ciphertext) == plaintext


class ReadOnlyProfileGateway(RemoteAgent):
    """A stateful protocol port keeps Verify distinct from business dispatch."""

    def __init__(self) -> None:
        super().__init__()
        self.verified: list[ConnectionSpec] = []
        self.failure: GatewayError | None = None
        self.auth_scope: Literal["passed_for_read_endpoint", "not_exercised"] = "not_exercised"
        self.card: JsonObject = {
            "name": "Remote declaration",
            "description": "Remote description",
            "version": "1.0",
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
            "capabilities": {"streaming": False, "extensions": [{"uri": TRACEABILITY_URI}]},
            "skills": [],
            "securitySchemes": {"bearer": {"httpAuthSecurityScheme": {"scheme": "bearer"}}},
        }

    @override
    def verify(self, connection: ConnectionSpec, *, timeout_seconds: float = 30) -> VerificationResult:
        assert timeout_seconds == 30
        self.verified.append(connection)
        if self.failure is not None:
            raise self.failure
        return VerificationResult(
            card=copy.deepcopy(self.card),
            interface_url=connection.endpoint + "/a2a",
            remote_tenant=None,
            auth_check=self.auth_scope,
            card_fingerprint=sha256(json.dumps(self.card, sort_keys=True).encode()).hexdigest(),
            streaming=False,
            required_extensions=(),
        )


class OwnedUploads:
    """Deterministic owned blob IO with real persisted upload/expiry transitions."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions
        self.blobs: dict[str, bytes] = {}
        self.owners: dict[str, tuple[str, str]] = {}
        self.plans: list[FileWriteReservation] = []
        self.fail_upload = False
        self.fail_remove = False
        self.expire_on_upload = False
        self.fetches: list[str] = []
        self.fetch_failure = False

    def plan(self, context: RequestContext, blob: FileBlob) -> FileWriteReservation:
        assert blob.data
        plan = FileWriteReservation(file_id=uid(), storage_key="test/" + uid())
        self.owners[plan.file_id] = (context.active_workspace_id, context.account_id)
        self.plans.append(plan)
        return plan

    def upload(self, context: RequestContext, blob: FileBlob, *, reserved_file_id: str) -> str:
        assert self.owners[reserved_file_id] == (context.active_workspace_id, context.account_id)
        self.blobs[reserved_file_id] = blob.data
        if self.expire_on_upload:
            with self.sessions.begin() as session:
                lease = session.scalars(
                    select(ExternalAgentFileLease).where(
                        ExternalAgentFileLease.file_id == reserved_file_id,
                        ExternalAgentFileLease.tenant_id == context.active_workspace_id,
                        ExternalAgentFileLease.owner_id == context.account_id,
                    )
                ).one()
                lease.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
        if self.fail_upload:
            raise OSError("Simulated object-store acknowledgement loss.")
        return reserved_file_id

    def remove(self, plan: FileWriteReservation) -> None:
        if self.fail_remove:
            raise OSError("Simulated cleanup outage.")
        self.blobs.pop(plan.file_id, None)

    def fetch(self, context: RequestContext, *, url: str, filename: str, media_type: str) -> FileBlob:
        assert context.account_id
        assert url == "https://files.example.test/allowed.txt"
        self.fetches.append(url)
        if self.fetch_failure:
            raise ExternalIOError("file_fetch_failed", "Controlled URL fetch failure.")
        return FileBlob(filename=filename, media_type=media_type, data=b"bytes")


@dataclass
class ControlPlane:
    database: Domain
    context: RequestContext
    assets: ExternalAssetService
    tests: ExternalTestService
    store: ExternalAssetRepository
    access: MembershipAccess
    gateway: ReadOnlyProfileGateway
    secrets: TenantSecrets
    uploads: OwnedUploads
    runtime: ExternalInvocationService
    clock: Clock

    def role(self, role: TenantAccountRole | None) -> None:
        with self.database[1].begin() as session:
            row = session.scalars(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == self.context.active_workspace_id,
                    TenantAccountJoin.account_id == self.context.account_id,
                )
            ).one()
            if role is None:
                session.delete(row)
            else:
                row.role = role

    def verify(
        self, *, agent: str | None = None, auth: str = "none", action: str = "remove", credential: str | None = None
    ) -> VerificationEvidence:
        revision = (
            self.store.get_asset(
                tenant_id=self.context.active_workspace_id, agent_id=agent
            ).active_connection_revision_id
            if agent
            else None
        )
        return self.assets.verify(
            self.context,
            endpoint="https://control.example.test",
            auth_type=auth,
            credential_action=action,
            credential=credential,
            agent_id=agent,
            expected_connection_revision_id=revision,
        )

    def create(
        self, *, metadata: dict[str, object] | None = None, proof: VerificationEvidence | None = None
    ) -> OperationResult:
        evidence = proof or self.verify()
        return self.assets.create(
            self.context,
            verification_id=evidence.id,
            metadata=metadata or {"name": "Local " + uid()},
            operation_key=uid(),
        )

    def start(
        self,
        *,
        agent: str | None = None,
        page: str = "page",
        key: str = "run",
        generation: int = 1,
        text: str = "Task",
        leases: tuple[str, ...] = (),
    ) -> Invocation:
        return self.tests.start(
            self.context,
            agent_id=agent or self.database[3],
            page_session_id=page,
            expected_generation=generation,
            idempotency_key=key,
            task_text=text,
            input_lease_ids=leases,
            outputs=(OutputField(name="text", kind="string"),),
            policy=WaitPolicy(),
        )


@pytest.fixture
def control(domain: Domain) -> ControlPlane:
    repo, sessions, scope, _, _ = domain
    engine = bound_engine(sessions)
    TypeBase.metadata.create_all(
        engine,
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (ExternalAgentVerification, ExternalAgentOperation, Workflow, WorkflowAgentNodeBinding)
        ],
    )
    context = RequestContext("control", None, scope.initiator_id, scope.tenant_id)
    gateway, access, secrets, uploads = (
        ReadOnlyProfileGateway(),
        MembershipAccess(sessions),
        TenantSecrets(),
        OwnedUploads(sessions),
    )
    runtime, clock, _, _ = runtime_service(domain, gateway)
    clock.value = datetime.now(UTC)
    assets = ExternalAssetService(
        store=ExternalAssetRepository(session_factory=sessions),
        access=access,
        reference_access=access,
        gateway=gateway,
        secrets=secrets,
        clock=clock.now,
        new_id=uid,
        limits=ExternalAgentLimits(),
    )
    limits = FileLimits()
    tests = ExternalTestService(
        assets=ExternalAssetRepository(session_factory=sessions),
        access=access,
        runtime=runtime,
        files=ExternalTestFileRepository(sessions=sessions, limits=limits),
        uploads=uploads,
        limits=limits,
        max_variable_bytes=16,
    )
    return ControlPlane(
        domain,
        context,
        assets,
        tests,
        ExternalAssetRepository(session_factory=sessions),
        access,
        gateway,
        secrets,
        uploads,
        runtime,
        clock,
    )


def test_verify_consumption_recovery_and_public_detail_never_return_credentials(control: ControlPlane) -> None:
    proof = control.verify(auth="bearer", action="replace", credential="synthetic-token")
    assert proof.auth_check == "not_exercised"
    assert proof.credential_ciphertext
    assert control.gateway.sent == []
    first = control.assets.create(
        control.context, verification_id=proof.id, metadata={"name": "Local alias"}, operation_key="save"
    )
    recovered = control.assets.operation(control.context, first.id)
    assert recovered == first
    assert (
        control.assets.create(
            control.context, verification_id=proof.id, metadata={"name": "Local alias"}, operation_key="save"
        )
        == first
    )
    with pytest.raises(ExternalAgentIdempotencyConflictError):
        control.assets.create(
            control.context, verification_id=proof.id, metadata={"name": "Changed"}, operation_key="save"
        )
    detail = control.assets.detail(control.context, first.resource_id)
    assert detail["asset"]["name"] == "Local alias"
    assert detail["connection"]["has_credential"] is True
    assert "securitySchemes" not in detail["connection"]["card"]
    assert "credential_ciphertext" not in detail["connection"]
    assert "synthetic-token" not in json.dumps(detail, default=str)
    with control.database[1]() as session:
        saved = stored(session, ExternalAgentVerification, proof.id)
        assert saved.consumed_at is not None
        assert saved.credential_ciphertext is None
    assert control.gateway.sent == []


def test_bearer_keep_same_replace_new_replace_and_remove_obey_revision_cas(control: ControlPlane) -> None:
    created = control.create(proof=control.verify(auth="bearer", action="replace", credential="first-token"))
    agent = created.resource_id
    initial = control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=agent)
    for action, credential in (("keep", None), ("replace", "first-token")):
        proof = control.verify(agent=agent, auth="bearer", action=action, credential=credential)
        before = control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=agent)
        result = control.assets.update_connection(
            control.context,
            agent_id=agent,
            verification_id=proof.id,
            expected_revision_id=before.active_connection_revision_id,
            operation_key=uid(),
        )
        assert result.result["changed"] is False
        assert control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=agent) == before
    stale = control.verify(agent=agent)
    changed = control.verify(agent=agent, auth="bearer", action="replace", credential="second-token")
    saved = control.assets.update_connection(
        control.context,
        agent_id=agent,
        verification_id=changed.id,
        expected_revision_id=initial.active_connection_revision_id,
        operation_key="change",
    )
    assert saved.result["changed"] is True
    assert (
        control.assets.update_connection(
            control.context,
            agent_id=agent,
            verification_id=changed.id,
            expected_revision_id=initial.active_connection_revision_id,
            operation_key="change",
        )
        == saved
    )
    with pytest.raises(ExternalAgentConflictError):
        control.assets.update_connection(
            control.context,
            agent_id=agent,
            verification_id=stale.id,
            expected_revision_id=initial.active_connection_revision_id,
            operation_key=uid(),
        )
    verified_count = len(control.gateway.verified)
    with pytest.raises(ExternalAgentConflictError):
        control.assets.verify(
            control.context,
            endpoint="https://control.example.test",
            auth_type="none",
            credential_action="remove",
            credential=None,
            agent_id=agent,
            expected_connection_revision_id=initial.active_connection_revision_id,
        )
    assert len(control.gateway.verified) == verified_count
    proof = control.verify(agent=agent)
    before = control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=agent)
    control.assets.update_connection(
        control.context,
        agent_id=agent,
        verification_id=proof.id,
        expected_revision_id=before.active_connection_revision_id,
        operation_key=uid(),
    )
    assert control.assets.detail(control.context, agent)["connection"]["has_credential"] is False
    assert control.gateway.sent == []


@pytest.mark.parametrize(
    ("auth", "action", "credential"),
    [
        ("oauth", "remove", None),
        ("none", "unknown", None),
        ("none", "remove", "unexpected"),
        ("bearer", "keep", None),
        ("bearer", "remove", None),
        ("bearer", "replace", ""),
        ("bearer", "replace", "bad token"),
        ("bearer", "replace", "x" * 8193),
    ],
)
def test_invalid_auth_configuration_cannot_make_a_proof_or_call_the_peer(
    control: ControlPlane, auth: str, action: str, credential: str | None
) -> None:
    with pytest.raises(ExternalAgentInvalidInputError):
        control.verify(auth=auth, action=action, credential=credential)
    with control.database[1]() as session:
        assert session.scalar(select(func.count()).select_from(ExternalAgentVerification)) == 0
    assert control.gateway.verified == []
    assert control.gateway.sent == []


def test_failed_read_auth_never_saves_evidence_and_public_scope_does_not_claim_execution(control: ControlPlane) -> None:
    control.gateway.failure = GatewayError("authentication_failed", "Read-only credential check rejected.")
    with pytest.raises(ExternalAgentVerificationFailedError):
        control.verify(auth="bearer", action="replace", credential="valid-shape")
    with control.database[1]() as session:
        assert session.scalar(select(func.count()).select_from(ExternalAgentVerification)) == 0
    control.gateway.failure = None
    control.gateway.auth_scope = "passed_for_read_endpoint"
    proof = control.verify(auth="bearer", action="replace", credential="valid-shape")
    assert proof.auth_check == "passed_for_read_endpoint"
    assert len(control.gateway.verified) == 2
    assert control.gateway.sent == []
    with pytest.raises(ExternalAgentInvalidInputError):
        control.assets.verify(
            control.context,
            endpoint="https://control.example.test",
            auth_type="none",
            credential_action="remove",
            credential=None,
            agent_id=None,
            expected_connection_revision_id=uid(),
        )


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
def test_managers_metadata_noop_actual_reset_switches_and_delete_are_persisted(
    control: ControlPlane, role: TenantAccountRole
) -> None:
    control.role(role)
    created = control.create(
        metadata={"name": "Managed", "description": "", "role": "Reviewer", "icon_type": "emoji", "icon": "A"}
    )
    agent = created.resource_id
    before = control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=agent)
    same = control.assets.update_info(
        control.context, agent_id=agent, expected_revision=before.metadata_revision, changes={"description": ""}
    )
    assert same == before
    edited = control.assets.update_info(
        control.context,
        agent_id=agent,
        expected_revision=before.metadata_revision,
        changes={"role": "Changed", "icon_type": None, "icon": None, "icon_background": None},
    )
    assert edited.test_display_generation == before.test_display_generation + 1
    assert len(control.gateway.verified) == 1
    with pytest.raises(ExternalAgentConflictError):
        control.assets.update_info(
            control.context,
            agent_id=agent,
            expected_revision=before.metadata_revision,
            changes={"description": "Stale"},
        )
    assert not control.assets.set_enabled(control.context, agent, False).enabled
    assert control.assets.set_enabled(control.context, agent, True).enabled
    assert control.assets.set_tracing(control.context, agent, True).tracing_enabled
    assert not control.assets.set_tracing(control.context, agent, False).tracing_enabled
    assert control.assets.references(control.context, agent).apps == ()
    control.assets.delete(control.context, agent)
    with pytest.raises(ExternalAgentNotFoundError):
        control.assets.detail(control.context, agent)
    assert control.assets.operation(control.context, created.id).resource_id == agent
    assert control.gateway.sent == []


@pytest.mark.parametrize("role", [TenantAccountRole.EDITOR, TenantAccountRole.NORMAL, None])
def test_nonmanagers_cannot_mutate_or_verify_but_members_can_list(
    control: ControlPlane, role: TenantAccountRole | None
) -> None:
    control.role(role)
    agent = control.database[3]
    actions: tuple[Callable[[], object], ...] = (
        lambda: control.verify(),
        lambda: control.create(),
        lambda: control.assets.update_info(
            control.context, agent_id=agent, expected_revision=1, changes={"name": "Denied"}
        ),
        lambda: control.assets.update_connection(
            control.context, agent_id=agent, verification_id=uid(), expected_revision_id=uid(), operation_key=uid()
        ),
        lambda: control.assets.set_enabled(control.context, agent, False),
        lambda: control.assets.set_tracing(control.context, agent, False),
        lambda: control.assets.delete(control.context, agent),
        lambda: control.assets.operation(control.context, uid()),
    )
    for action in actions:
        with pytest.raises(ExternalAgentForbiddenError):
            action()
    if role is None:
        with pytest.raises(ExternalAgentForbiddenError):
            control.assets.list(control.context, page=1, limit=20, keyword=None, enabled=None, connected_by_me=False)
    else:
        assert (
            control.assets.list(
                control.context, page=1, limit=20, keyword=None, enabled=None, connected_by_me=False
            ).total
            == 1
        )
    if role == TenantAccountRole.EDITOR:
        assert control.assets.detail(control.context, agent)["asset"]["id"] == agent
    else:
        with pytest.raises(ExternalAgentForbiddenError):
            control.assets.detail(control.context, agent)
    assert control.gateway.verified == []
    assert control.gateway.sent == []


def test_selectors_and_reference_reads_keep_visibility_and_connected_by_actor_scope(control: ControlPlane) -> None:
    agent = control.create().resource_id
    own = control.assets.list(control.context, page=1, limit=20, keyword="Local", enabled=True, connected_by_me=True)
    assert [item.id for item in own.items] == [agent]
    control.access.visibility = frozenset({control.database[3]})
    assert (
        control.assets.list(control.context, page=1, limit=20, keyword=None, enabled=None, connected_by_me=True).items
        == ()
    )
    with pytest.raises(ExternalAgentForbiddenError):
        control.assets.detail(control.context, agent)
    with pytest.raises(ExternalAgentForbiddenError):
        control.assets.references(control.context, agent)
    for page, limit in ((0, 20), (1, 0), (1, 101)):
        with pytest.raises(ExternalAgentInvalidInputError):
            control.assets.list(
                control.context, page=page, limit=limit, keyword=None, enabled=None, connected_by_me=False
            )


@pytest.mark.parametrize(
    "metadata",
    [
        {"endpoint": "https://cannot-change.test"},
        {"name": " "},
        {"name": None},
        {"name": "n" * 256},
        {"description": 1},
        {"description": "d" * 10001},
        {"role": "r" * 256},
        {"icon_type": "unsupported"},
    ],
)
def test_invalid_presentation_cannot_consume_valid_proof(control: ControlPlane, metadata: dict[str, object]) -> None:
    proof = control.verify()
    with pytest.raises(ExternalAgentInvalidInputError):
        control.create(metadata=metadata, proof=proof)
    with control.database[1]() as session:
        assert stored(session, ExternalAgentVerification, proof.id).consumed_at is None
    for key in ("", "k" * 256):
        with pytest.raises(ExternalAgentInvalidInputError):
            control.assets.create(control.context, verification_id=proof.id, metadata={}, operation_key=key)
    assert control.gateway.sent == []


def test_trace_unsupported_and_bearer_keep_without_saved_secret_reject_without_dispatch(control: ControlPlane) -> None:
    agent = control.database[3]
    with pytest.raises(ExternalAgentInvalidInputError):
        control.assets.set_tracing(control.context, agent, True)
    with pytest.raises(ExternalAgentInvalidInputError):
        control.verify(agent=agent, auth="bearer", action="keep")
    assert control.gateway.verified == []
    assert control.gateway.sent == []


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_overview_run_while_disabled_is_idempotent_and_pins_exact_generation(
    control: ControlPlane, role: TenantAccountRole
) -> None:
    control.role(role)
    agent = control.database[3]
    with control.database[1].begin() as session:
        stored(session, ExternalAgentHead, agent).enabled = False
    first, repeated = control.start(), control.start()
    assert first.id == repeated.id
    assert first.message_id == repeated.message_id
    assert first.scope.origin == "overview_test"
    assert first.scope.app_id is None
    assert (
        control.tests.result(control.context, agent_id=agent, invocation_id=first.id).metadata["anchor_invocation_id"]
        == first.id
    )
    with control.database[1]() as session:
        assert session.scalar(select(func.count()).select_from(ExternalAgentInvocation)) == 1
    command(control.database, control.runtime, control.clock, "dispatch")
    assert len(control.gateway.sent) == 1
    canceled = control.tests.cancel(control.context, agent_id=agent, invocation_id=first.id)
    assert canceled.id == first.id
    assert canceled.cancel_state == CancelState.REQUESTED


def test_test_result_url_actor_and_generation_cannot_retarget_other_work(control: ControlPlane) -> None:
    agent = control.database[3]
    first = control.start()
    other = control.create().resource_id
    for read in (control.tests.result, control.tests.cancel):
        with pytest.raises(ExternalAgentNotFoundError):
            read(control.context, agent_id=other, invocation_id=first.id)
    previous = control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=agent)
    control.assets.update_info(
        control.context,
        agent_id=agent,
        expected_revision=previous.metadata_revision,
        changes={"description": "Real edit"},
    )
    with pytest.raises(ExternalAgentConflictError):
        control.tests.result(control.context, agent_id=agent, invocation_id=first.id)
    with pytest.raises(ExternalAgentConflictError):
        control.start()
    second = control.start(generation=2)
    assert second.id != first.id
    exact = control.tests.cancel(control.context, agent_id=agent, invocation_id=first.id)
    assert exact.id == first.id
    assert exact.local_state == LocalState.STOPPED
    assert control.tests.result(control.context, agent_id=agent, invocation_id=second.id).state == LocalState.WAITING
    assert control.gateway.sent == []


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, None])
def test_overview_non_test_roles_cannot_upload_run_read_clear_or_cancel(
    control: ControlPlane, role: TenantAccountRole | None
) -> None:
    control.role(role)
    agent = control.database[3]
    actions: tuple[Callable[[], object], ...] = (
        lambda: control.start(),
        lambda: control.tests.result(control.context, agent_id=agent, invocation_id=uid()),
        lambda: control.tests.cancel(control.context, agent_id=agent, invocation_id=uid()),
        lambda: control.tests.release_file(control.context, agent_id=agent, lease_id=uid()),
        lambda: control.tests.upload(
            control.context,
            agent_id=agent,
            page_session_id="page",
            blob=FileBlob(filename="f.txt", media_type="text/plain", data=b"bytes"),
        ),
    )
    for action in actions:
        with pytest.raises(ExternalAgentForbiddenError):
            action()
    assert control.uploads.plans == []
    assert control.gateway.sent == []


@pytest.mark.parametrize("page", ["", "has space", "has\nnewline", "p" * 129])
def test_invalid_page_never_creates_upload_intent_or_invocation(control: ControlPlane, page: str) -> None:
    with pytest.raises(ExternalAgentInvalidInputError):
        control.start(page=page)
    with pytest.raises(ExternalAgentInvalidInputError):
        control.tests.upload(
            control.context,
            agent_id=control.database[3],
            page_session_id=page,
            blob=FileBlob(filename="file.txt", media_type="text/plain", data=b"bytes"),
        )
    assert control.uploads.plans == []
    assert control.gateway.sent == []


def test_request_byte_bound_and_display_configuration_fail_before_business_submission(control: ControlPlane) -> None:
    for key, text in (("", "Task"), ("k" * 256, "Task"), ("utf8", "é" * 9)):
        with pytest.raises(ExternalAgentInvalidInputError):
            control.start(key=key, text=text)
    with pytest.raises(ExternalIOError):
        control.tests.start(
            control.context,
            agent_id=control.database[3],
            page_session_id="page",
            expected_generation=1,
            idempotency_key="file-default",
            task_text="Task",
            input_lease_ids=(),
            policy=WaitPolicy(),
            outputs=(OutputField(name="report", kind="file", has_default=True, default={"upload_file_id": uid()}),),
        )
    control.access.visibility = frozenset()
    with pytest.raises(ExternalAgentForbiddenError):
        control.start()
    assert control.gateway.sent == []


def test_uploaded_and_pasted_inputs_use_owned_lease_metadata_and_clear_idempotently(control: ControlPlane) -> None:
    agent = control.database[3]
    uploaded = control.tests.upload(
        control.context,
        agent_id=agent,
        page_session_id="upload",
        blob=FileBlob(filename="owned.txt", media_type="text/plain", data=b"bytes"),
    )
    assert control.uploads.blobs[uploaded.file_id] == b"bytes"
    control.tests.release_file(control.context, agent_id=agent, lease_id=uploaded.lease_id)
    control.tests.release_file(control.context, agent_id=agent, lease_id=uploaded.lease_id)
    pasted = control.tests.paste_link(
        control.context,
        agent_id=agent,
        page_session_id="paste",
        url="https://files.example.test/allowed.txt",
        filename="copy.txt",
        media_type="text/plain",
    )
    invocation = control.start(page="paste", leases=(pasted.lease_id,))
    assert invocation.parts[1] == {"fileRef": {"file_id": pasted.file_id, "kind": "upload"}}
    control.tests.release_file(control.context, agent_id=agent, lease_id=pasted.lease_id)
    with control.database[1]() as session:
        lease = stored(session, ExternalAgentFileLease, pasted.lease_id)
        assert lease.invocation_id == invocation.id
        assert lease.released_at is None
        assert stored(session, ExternalAgentFileLease, uploaded.lease_id).released_at is not None
    assert control.uploads.fetches == ["https://files.example.test/allowed.txt"]
    assert control.gateway.sent == []


@pytest.mark.parametrize("failure", ["upload", "cleanup", "expiry"])
def test_partial_upload_failure_preserves_durable_cleanup_intent(control: ControlPlane, failure: str) -> None:
    control.uploads.fail_upload = failure != "expiry"
    control.uploads.fail_remove = failure == "cleanup"
    control.uploads.expire_on_upload = failure == "expiry"
    with pytest.raises((OSError, ExternalAgentConflictError)):
        control.tests.upload(
            control.context,
            agent_id=control.database[3],
            page_session_id="page",
            blob=FileBlob(filename="owned.txt", media_type="text/plain", data=b"bytes"),
        )
    with control.database[1]() as session:
        lease = session.scalars(select(ExternalAgentFileLease)).one()
        assert lease.write_state == "aborted"
        assert lease.released_at is not None
        assert lease.storage_key
    assert bool(control.uploads.blobs) is (failure == "cleanup")
    assert control.gateway.sent == []


def test_fetch_failure_and_left_page_cannot_create_or_revive_input_or_business_work(control: ControlPlane) -> None:
    agent = control.database[3]
    control.uploads.fetch_failure = True
    with pytest.raises(ExternalIOError, match="fetch"):
        control.tests.paste_link(
            control.context,
            agent_id=agent,
            page_session_id="page",
            url="https://files.example.test/allowed.txt",
            filename="copy.txt",
            media_type="text/plain",
        )
    assert control.uploads.plans == []
    with control.database[1].begin() as session:
        session.add(
            ExternalAgentDataTombstone(
                id=uid(),
                tenant_id=control.context.active_workspace_id,
                owner_kind="test_page",
                owner_id=sha256(f"{control.context.account_id}:left".encode()).hexdigest(),
                deleted_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
    with pytest.raises(ExternalAgentConflictError, match="left"):
        control.start(page="left")
    with pytest.raises(ExternalAgentConflictError, match="left"):
        control.tests.upload(
            control.context,
            agent_id=agent,
            page_session_id="left",
            blob=FileBlob(filename="file.txt", media_type="text/plain", data=b"bytes"),
        )
    assert control.uploads.blobs == {}
    assert control.gateway.sent == []
