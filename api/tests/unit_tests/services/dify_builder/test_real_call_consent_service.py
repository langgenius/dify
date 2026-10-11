"""Durable one-shot real-call consent on real SQLite owner rows.

Seeds the existing ``owned`` owner fixture with a committed session, a saved
test input, an exact Gmail Start → Tool → End draft and actual native OAuth
credential/client rows. Only the external installation owner is faked: its
metadata and the qualification constants are SYNTHETIC test-only values that
exercise exact matching. They are not evidence about any installed or deployed
artifact; real qualification stays unavailable (constants ``None``, flag off).
SQLite proves transaction contents, not PostgreSQL lock behavior (CI-owned).
"""

import importlib
import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from types import ModuleType
from typing import TYPE_CHECKING, Literal, Never, cast
from uuid import uuid4

import pytest
from sqlalchemy import Table, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.dify_builder import gmail_read_policy
from core.dify_builder.errors import ConflictError
from core.dify_builder.execution_policy import (
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    context_digest,
    validate_execution_context,
)
from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, ConversationItem, DifyBuilderContext, MutationIntent
from core.dify_builder.real_call_consent import (
    ActionOutcome,
    ConfirmedToolBinding,
    ConsentBinding,
    ConsentReceipt,
    ConsentState,
    GmailReadParameters,
    InstalledToolBinding,
    scope_digest,
    validate_phase,
)
from core.dify_builder.state import PcState
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.plugin_service import PluginService
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.credential_permission import CredentialPermission
from models.credential_permission import CredentialType as CredentialPermissionType
from models.dify_builder import (
    DifyBuilderConversationItem,
    DifyBuilderExecutionRequest,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.enums import PermissionEnum
from models.model import App
from models.tools import BuiltinToolProvider, ToolOAuthTenantClient
from models.workflow import Workflow
from services.dify_builder import real_call_metadata
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import execution_revision
from services.dify_builder.serde import context_from_dict, context_to_dict
from services.tools.builder_credential_reference import credential_revision, select_builder_credential
from tests.unit_tests.core.dify_builder.test_gmail_read_policy import gmail_graph, tool_data
from tests.unit_tests.services.dify_builder.test_execution_policy_service import (
    owned as owned,  # noqa: PLC0414 - shared pytest fixture
)

if TYPE_CHECKING:
    from models.dify_builder import DifyBuilderRealCallConsent
    from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService

PROVIDER = "langgenius/dify-gmail/dify-gmail"
PLUGIN = "langgenius/dify-gmail"
SECRET = "unit-consent-secret"
CIPHERTEXT = '{"access_token":"enc-access-sentinel","refresh_token":"enc-refresh-sentinel"}'
CLIENT_CIPHERTEXT = '{"client_id":"enc-client-sentinel","client_secret":"enc-secret-sentinel"}'
# SYNTHETIC test-only artifact; never a reviewed, qualified or deployed revision.
SYNTHETIC_VERSION = "9.9.9"
SYNTHETIC_CHECKSUM = "f" * 64
SYNTHETIC_ARTIFACT = f"{PLUGIN}:{SYNTHETIC_VERSION}@{SYNTHETIC_CHECKSUM}"
SYNTHETIC_SCHEMA = "e" * 64
SYNTHETIC_AUDIT = "synthetic-test-audit-revision"
APPROVED = GmailReadParameters(message_id="18cab_1", include_body=False, include_attachments=False)
START_VARIABLES: list[dict[str, object]] = [
    {"variable": "note", "label": "Note", "type": "text-input", "required": False, "max_length": 48}
]
SECRET_SENTINELS = ("enc-access-sentinel", "enc-refresh-sentinel", "enc-client-sentinel", "enc-secret-sentinel")


def service_module() -> ModuleType:
    # Imported lazily so each test fails on its own behavior before the owner exists.
    return importlib.import_module("services.dify_builder.real_call_consent_service")


def consent_model() -> "type[DifyBuilderRealCallConsent]":
    return importlib.import_module("models.dify_builder").DifyBuilderRealCallConsent


def synthetic_installed(tenant_id: str) -> InstalledToolBinding:
    return InstalledToolBinding(
        tenant_id=tenant_id,
        installation_id="synthetic-installation",
        plugin_id=PLUGIN,
        provider_id=PROVIDER,
        tool_name="get_message",
        unique_identifier=SYNTHETIC_ARTIFACT,
        version=SYNTHETIC_VERSION,
        checksum=SYNTHETIC_CHECKSUM,
        schema_digest=SYNTHETIC_SCHEMA,
        source_audit_revision=SYNTHETIC_AUDIT,
        daemon_contract_revision=gmail_read_policy.DAEMON_CONTRACT_REVISION,
        runtime_type="local",
    )


@dataclass
class Owner:
    factory: sessionmaker[Session]
    actor: Actor
    app_id: str
    workflow_id: str
    session_id: str
    test_input_id: str
    credential_id: str
    client_id: str
    metadata_reads: list[str]

    def service(self) -> "BuilderRealCallConsentService":
        return service_module().BuilderRealCallConsentService(self.factory)

    def revision(self) -> str:
        with self.factory() as db:
            workflow = db.get(Workflow, self.workflow_id)
            assert workflow is not None
            return execution_revision(workflow)

    def count(self, model: type) -> int:
        with self.factory() as db:
            return db.scalar(select(func.count()).select_from(model)) or 0

    def consents(self) -> int:
        return self.count(consent_model())

    def consent_row(self, consent_id: str) -> "DifyBuilderRealCallConsent":
        with self.factory() as db:
            row = db.get(consent_model(), consent_id)
            assert row is not None
            return row

    def full_reference_revision(self) -> str:
        with self.factory() as db:
            return select_builder_credential(
                db,
                actor=self.actor,
                provider_id=PROVIDER,
                credential_id=self.credential_id,
                verified_plugin=False,
                revision_key=SECRET.encode(),
            ).reference.revision


@pytest.fixture
def consent_owner(
    owned: tuple[sessionmaker[Session], Actor, App, Workflow, str, str], monkeypatch: pytest.MonkeyPatch
) -> Owner:
    factory, actor, app, workflow, session_id, test_input_id = owned
    monkeypatch.setattr(dify_config, "SECRET_KEY", SECRET)
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_TOOL_ENABLED", True)
    # SYNTHETIC qualification constants solely so the exact-match code paths run.
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_ARTIFACT", SYNTHETIC_ARTIFACT)
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_SCHEMA_DIGEST", SYNTHETIC_SCHEMA)
    monkeypatch.setattr(gmail_read_policy, "GMAIL_SOURCE_AUDIT_REVISION", SYNTHETIC_AUDIT)
    reads: list[str] = []

    def fake_installation(*, tenant_id: str, provider_id: str) -> InstalledToolBinding:
        assert provider_id == PROVIDER
        reads.append(tenant_id)
        return synthetic_installed(tenant_id)

    def fake_verified(tenant_id: str, plugin_unique_identifier: str) -> bool:
        assert (tenant_id, plugin_unique_identifier) == (actor.tenant_id, SYNTHETIC_ARTIFACT)
        return False

    monkeypatch.setattr(real_call_metadata, "resolve_installed_get_message", fake_installation)
    monkeypatch.setattr(PluginService, "is_plugin_verified", fake_verified)
    with factory.begin() as db:
        credential = BuiltinToolProvider(
            name="Team mailbox",
            tenant_id=actor.tenant_id,
            user_id=actor.account_id,
            provider=PROVIDER,
            credential_type=CredentialType.OAUTH2,
            encrypted_credentials=CIPHERTEXT,
            expires_at=1_900_000_000,
            visibility=PermissionEnum.ALL_TEAM,
            is_default=False,
        )
        client = ToolOAuthTenantClient(tenant_id=actor.tenant_id, plugin_id=PLUGIN, provider="dify-gmail")
        client.encrypted_oauth_params = CLIENT_CIPHERTEXT
        client.enabled = True
        db.add_all([credential, client])
        db.flush()
        graph = gmail_graph(tool=tool_data(credential_id=credential.id), start_variables=START_VARIABLES)
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = json.dumps(graph)
        test_input = db.get(DifyBuilderTestInput, test_input_id)
        assert test_input is not None
        test_input.inputs = {"note": "hello"}
        test_input.start_schema_hash = schema_hash(start_schema(graph))
        db.add(
            DifyBuilderSessionCommit(
                session_id=session_id,
                version=1,
                state=str(PcState.BUILD_AWAIT_TESTDATA),
                context=context_to_dict(
                    DifyBuilderContext(plan_items=["Read one message"], plan_version_tag="plan-1", next_seq=1)
                ),
                actor="",
            )
        )
        db.add(DifyBuilderConversationItem(session_id=session_id, seq=0, kind="notice", payload={}, at_version=1))
        credential_id, client_id = credential.id, client.id
    return Owner(factory, actor, app.id, workflow.id, session_id, test_input_id, credential_id, client_id, reads)


def overrides(changes: dict[str, object]) -> dict[str, Never]:
    # Refusal cases deliberately pass ill-typed values (bool versions, unknown decisions);
    # the localized cast keeps the typed dataclass fields while allowing those cases.
    return cast(dict[str, Never], changes)


@dataclass(frozen=True)
class PrepareArgs:
    actor: Actor
    session_id: str
    test_input_id: str
    credential_id: str
    base_app_revision: str
    node_id: str = "tool"
    at_version: int = 1
    idempotency_key: str = "prepare-1"


@dataclass(frozen=True)
class DecisionArgs:
    actor: Actor
    session_id: str
    consent_id: str
    scope_digest: str
    at_version: int
    decision: Literal["confirm", "decline"] = "confirm"
    idempotency_key: str = "confirm-1"


def prepare(owner: Owner, **changes: object) -> ConsentReceipt:
    args = replace(
        PrepareArgs(owner.actor, owner.session_id, owner.test_input_id, owner.credential_id, owner.revision()),
        **overrides(changes),
    )
    return owner.service().prepare(
        actor=args.actor,
        session_id=args.session_id,
        node_id=args.node_id,
        test_input_id=args.test_input_id,
        credential_id=args.credential_id,
        at_version=args.at_version,
        base_app_revision=args.base_app_revision,
        idempotency_key=args.idempotency_key,
    )


def decision_args(owner: Owner, receipt: ConsentReceipt, **changes: object) -> DecisionArgs:
    base = DecisionArgs(owner.actor, owner.session_id, receipt.consent_id, receipt.scope_digest, receipt.at_version)
    return replace(base, **overrides(changes))


def confirm(owner: Owner, receipt: ConsentReceipt, **changes: object) -> ConsentReceipt:
    args = decision_args(owner, receipt, **changes)
    return owner.service().confirm(
        actor=args.actor,
        session_id=args.session_id,
        consent_id=args.consent_id,
        decision=args.decision,
        scope_digest=args.scope_digest,
        at_version=args.at_version,
        idempotency_key=args.idempotency_key,
    )


def reserve(owner: Owner, receipt: ConsentReceipt, **changes: object) -> tuple[ConsentReceipt, bool]:
    args = decision_args(owner, receipt, **{"idempotency_key": "execute-1", **changes})
    return owner.service().reserve_execution(
        actor=args.actor,
        session_id=args.session_id,
        consent_id=args.consent_id,
        scope_digest=args.scope_digest,
        at_version=args.at_version,
        idempotency_key=args.idempotency_key,
    )


def get(owner: Owner, consent_id: str, actor: Actor | None = None) -> ConsentReceipt:
    return owner.service().get(actor=actor or owner.actor, session_id=owner.session_id, consent_id=consent_id)


def simulate_task6_launch(owner: Owner, receipt: ConsentReceipt) -> tuple[ConfirmedToolExecutionContext, str]:
    """Fixture stand-in for Task 6's launch-identity claim; not native Run proof."""
    run_id = str(uuid4())
    with owner.factory.begin() as db:
        request = db.get(DifyBuilderExecutionRequest, receipt.execution_request_id)
        assert request is not None
        request.state, request.native_run_id, request.task_id = "running", run_id, "fixture-task"
        context = validate_execution_context(request.context)
    assert isinstance(context, ConfirmedToolExecutionContext)
    return context, run_id


def claimed(owner: Owner) -> tuple[ConsentReceipt, ConfirmedToolBinding]:
    receipt = confirm(owner, prepare(owner))
    reserved, won = reserve(owner, receipt)
    assert won is True
    context, run_id = simulate_task6_launch(owner, reserved)
    binding = owner.service().claim_tool(
        context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution-1"
    )
    return reserved, binding


def shift_clock(monkeypatch: pytest.MonkeyPatch, delta: timedelta) -> None:
    base = datetime.now(UTC)
    monkeypatch.setattr(service_module(), "_utcnow", lambda: base + delta)


def assert_public(*receipts: ConsentReceipt, owner: Owner) -> None:
    text = json.dumps([receipt.model_dump(mode="json") for receipt in receipts])
    for sentinel in SECRET_SENTINELS:
        assert sentinel not in text
    assert owner.full_reference_revision() not in text
    assert "revision" not in text


def update_credential(owner: Owner, **values: object) -> None:
    with owner.factory.begin() as db:
        row = db.get(BuiltinToolProvider, owner.credential_id)
        assert row is not None
        for name, value in values.items():
            setattr(row, name, value)


# --- pure phase policy consumed by the durable service ---------------------------------


@pytest.mark.parametrize(
    ("state", "claimed_flag", "refresh_uncertain"),
    [
        ("prepared", False, False),
        ("declined", False, False),
        ("claimed", True, False),
        ("claimed", False, True),
        ("unknown", False, False),
    ],
)
def test_business_phase_cannot_reopen(state: ConsentState, claimed_flag: bool, refresh_uncertain: bool) -> None:
    now = datetime(2026, 10, 11, tzinfo=UTC)
    with pytest.raises(BuilderExecutionPolicyError):
        validate_phase(
            state=state,
            phase="business",
            claimed=claimed_flag,
            expires_at=now + timedelta(minutes=1),
            now=now,
            refresh_uncertain=refresh_uncertain,
        )


def test_phase_expiry_boundary_is_exclusive() -> None:
    now = datetime(2026, 10, 11, tzinfo=UTC)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_expired"):
        validate_phase(
            state="claimed", phase="refresh", claimed=False, expires_at=now, now=now, refresh_uncertain=False
        )
    validate_phase(
        state="claimed",
        phase="refresh",
        claimed=False,
        expires_at=now + timedelta(microseconds=1),
        now=now,
        refresh_uncertain=False,
    )


# --- repository extraction -------------------------------------------------------------


def test_compare_and_advance_wrapper_and_in_session_helper_share_one_body(consent_owner: Owner) -> None:
    owner = consent_owner
    repo = SqlDifyBuilderRepository(owner.factory)
    _session, fc = repo.get_session(owner.session_id)
    fc.last_command_id = "wrapper-command"
    assert repo.compare_and_advance(owner.session_id, 1, PcState.BUILD_AWAIT_TESTDATA, fc, []) == 2
    fc.last_command_id = "helper-command"

    def advance_then_abort() -> None:
        with owner.factory.begin() as db:
            assert repo._compare_and_advance_in_session(db, owner.session_id, 2, PcState.BUILD_REVIEW, fc, []) == 3
            raise RuntimeError("caller aborted")

    with pytest.raises(RuntimeError, match="caller aborted"):
        advance_then_abort()
    session, fc_after = repo.get_session(owner.session_id)
    # The helper joined the caller's transaction, so the caller's rollback undid it.
    assert (session.version, session.current_state, fc_after.last_command_id) == (
        2,
        PcState.BUILD_AWAIT_TESTDATA,
        "wrapper-command",
    )

    def stale_advance() -> None:
        with owner.factory.begin() as db:
            repo._compare_and_advance_in_session(db, owner.session_id, 1, PcState.BUILD_REVIEW, fc, [])

    with pytest.raises(ConflictError):
        stale_advance()


# --- table constraints -----------------------------------------------------------------


def test_counters_and_prepare_key_are_database_constrained(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = prepare(owner)
    model = consent_model()
    table = cast(Table, model.__table__)

    def write(**values: object) -> None:
        with owner.factory.begin() as db:
            db.execute(table.update().where(table.c.id == receipt.consent_id).values(**values))

    def duplicate_prepare_key() -> None:
        with owner.factory.begin() as db:
            original = db.execute(table.select().where(table.c.id == receipt.consent_id)).mappings().one()
            db.execute(table.insert().values({**original, "id": str(uuid4())}))

    with pytest.raises(IntegrityError):
        write(refresh_count=1)  # a counter without its claim timestamp
    with pytest.raises(IntegrityError):
        write(business_count=2, business_claimed_at=datetime(2026, 10, 11), claimed_at=datetime(2026, 10, 11))
    with pytest.raises(IntegrityError):
        write(refresh_count=1, refresh_claimed_at=datetime(2026, 10, 11))  # a phase without the grant claim
    with pytest.raises(IntegrityError):
        write(state="reserved")  # not a consent state
    with pytest.raises(IntegrityError):
        duplicate_prepare_key()
    assert owner.consents() == 1


# --- prepare -----------------------------------------------------------------------------


def test_unqualified_profile_or_disabled_flag_refuses_before_any_row(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_TOOL_ENABLED", False)
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_action"):
        prepare(owner)
    assert owner.metadata_reads == []
    # Restore the real unavailable profile and the real metadata owner.
    monkeypatch.undo()
    monkeypatch.setattr(dify_config, "SECRET_KEY", SECRET)
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_TOOL_ENABLED", True)
    assert gmail_read_policy.QUALIFIED_GMAIL_ARTIFACT is None
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_action"):
        prepare(owner)
    assert owner.consents() == 0


def test_prepare_binds_full_owner_chain_and_freezes_complete_disclosure(consent_owner: Owner) -> None:
    owner = consent_owner
    before = datetime.now(UTC)
    receipt = prepare(owner)
    assert owner.metadata_reads == [owner.actor.tenant_id]
    assert (receipt.state, receipt.at_version, receipt.can_retry) == ("prepared", 1, False)
    assert (receipt.command_id, receipt.execution_request_id, receipt.native_run_id) == (None, None, None)
    disclosure = receipt.disclosure
    assert (disclosure.credential_id, disclosure.credential_alias, disclosure.message_id) == (
        owner.credential_id,
        "Team mailbox",
        "18cab_1",
    )
    assert disclosure.request_url == "https://gmail.googleapis.com/gmail/v1/users/me/messages/18cab_1?format=full"
    assert (disclosure.include_body, disclosure.include_attachments, disclosure.automatic_replay) == (
        False,
        False,
        False,
    )
    assert disclosure.prior_uncertain_consent_id is None
    assert before + timedelta(minutes=10) <= disclosure.expires_at <= datetime.now(UTC) + timedelta(minutes=10)
    row = owner.consent_row(receipt.consent_id)
    binding = ConsentBinding.model_validate_json(json.dumps(row.binding))
    # The full owner reference (row primitive + effective access), not the row-only primitive.
    assert binding.credential.revision == owner.full_reference_revision()
    with owner.factory() as db:
        credential = db.get(BuiltinToolProvider, owner.credential_id)
        assert credential is not None
        assert binding.credential.revision != credential_revision(credential, key=SECRET.encode())
    assert binding.parameters == APPROVED
    assert (binding.actor_id, binding.session_id, binding.test_input_id, binding.prepared_version) == (
        owner.actor.account_id,
        owner.session_id,
        owner.test_input_id,
        1,
    )
    assert binding.installed == synthetic_installed(owner.actor.tenant_id)
    assert receipt.scope_digest == scope_digest(binding, key=SECRET.encode()) == row.scope_digest
    assert row.initial_credential_revision == binding.credential.revision
    assert row.prepare_receipt == receipt.model_dump(mode="json")
    assert row.disclosure == disclosure.model_dump(mode="json")
    assert_public(receipt, owner=owner)


def test_prepare_replay_returns_saved_receipt_and_changed_body_conflicts(consent_owner: Owner) -> None:
    owner = consent_owner
    first = prepare(owner)
    assert prepare(owner) == first
    for changes in ({"node_id": "end"}, {"at_version": 2}, {"base_app_revision": "0" * 64}):
        with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
            prepare(owner, **changes)
    assert owner.consents() == 1
    second = prepare(owner, idempotency_key="prepare-2")
    assert second.consent_id != first.consent_id
    assert owner.consents() == 2


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("stale_revision", "stale_app_revision"),
        ("stale_version", "stale_session_version"),
        ("wrong_node", "unsupported_tool_node"),
        ("other_credential", "credential_binding_mismatch"),
        ("foreign_input", "execution_owner_mismatch"),
        ("other_member", "execution_owner_mismatch"),
        ("malformed_session", "execution_owner_mismatch"),
        ("long_key", "invalid_idempotency_key"),
        ("bool_version", "invalid_version"),
        ("stale_schema_input", "unsupported_test_input"),
        ("working_state", "unsupported_session_state"),
        ("rotated_scope_key", "invalid_scope_key"),
    ],
)
def test_prepare_refusals_leave_no_row(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, change: str, reason: str
) -> None:
    owner = consent_owner
    changes: dict[str, object] = {}
    if change == "stale_revision":
        changes["base_app_revision"] = "0" * 64
    elif change == "stale_version":
        changes["at_version"] = 2
    elif change == "wrong_node":
        changes["node_id"] = "end"
    elif change == "other_credential":
        changes["credential_id"] = str(uuid4())
    elif change == "foreign_input":
        with owner.factory.begin() as db:
            row = db.get(DifyBuilderTestInput, owner.test_input_id)
            assert row is not None
            row.session_id = str(uuid4())
    elif change == "other_member":
        with owner.factory.begin() as db:
            other = Account(name="Teammate", email="teammate@example.invalid")
            db.add(other)
            db.flush()
            db.add(
                TenantAccountJoin(tenant_id=owner.actor.tenant_id, account_id=other.id, role=TenantAccountRole.ADMIN)
            )
            changes["actor"] = Actor(account_id=other.id, tenant_id=owner.actor.tenant_id)
    elif change == "malformed_session":
        changes["session_id"] = owner.session_id.upper()
    elif change == "long_key":
        changes["idempotency_key"] = "k" * 129
    elif change == "bool_version":
        changes["at_version"] = True
    elif change == "stale_schema_input":
        with owner.factory.begin() as db:
            row = db.get(DifyBuilderTestInput, owner.test_input_id)
            assert row is not None
            row.start_schema_hash = "0" * 64
    elif change == "working_state":
        with owner.factory.begin() as db:
            session = db.get(DifyBuilderSession, owner.session_id)
            assert session is not None
            session.current_state = str(PcState.BUILD_TEST_AND_REPAIR)
    elif change == "rotated_scope_key":
        monkeypatch.setattr(dify_config, "SECRET_KEY", "")
    with pytest.raises(BuilderExecutionPolicyError, match=reason):
        prepare(owner, **changes)
    assert owner.consents() == 0


def test_permission_denial_is_checked_outside_sql_and_creates_nothing(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.enterprise.rbac_service import RBACService

    owner = consent_owner
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(RBACService.CheckAccess, "check", lambda *_args, **_kwargs: False)
    with pytest.raises(BuilderExecutionPolicyError, match="execution_permission_denied"):
        prepare(owner)
    assert owner.consents() == 0
    assert owner.metadata_reads == []


def test_new_preparation_references_prior_unknown_consent(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    owner.service().claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    owner.service().finish(binding=binding, outcome=ActionOutcome(state="unknown", reason_code="stream_incomplete"))
    repo = SqlDifyBuilderRepository(owner.factory)
    session, fc = repo.get_session(owner.session_id)
    # The reserved command's own worker returns the session to review.
    version = repo.compare_and_advance(owner.session_id, session.version, PcState.BUILD_REVIEW, fc, [])
    fresh = prepare(owner, idempotency_key="prepare-after-unknown", at_version=version)
    assert fresh.consent_id != reserved.consent_id
    assert fresh.disclosure.prior_uncertain_consent_id == reserved.consent_id
    assert get(owner, reserved.consent_id).state == "unknown"


# --- confirm / decline -----------------------------------------------------------------


def test_identical_decision_replay_returns_saved_receipt_after_later_advancement(consent_owner: Owner) -> None:
    owner = consent_owner
    prepared = prepare(owner)
    decision = confirm(owner, prepared)
    assert (decision.state, decision.command_id, decision.can_retry) == ("confirmed", None, False)
    reserved, won = reserve(owner, decision)
    assert won is True
    context, run_id = simulate_task6_launch(owner, reserved)
    owner.service().claim_tool(
        context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution-1"
    )
    assert get(owner, prepared.consent_id).state == "claimed"
    assert confirm(owner, prepared) == decision
    assert owner.consent_row(prepared.consent_id).confirm_receipt == decision.model_dump(mode="json")


def test_decision_conflicts_and_mismatches_do_not_mutate(consent_owner: Owner) -> None:
    owner = consent_owner
    prepared = prepare(owner)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_scope_mismatch"):
        confirm(owner, prepared, scope_digest="a" * 64)
    with pytest.raises(BuilderExecutionPolicyError, match="stale_consent_version"):
        confirm(owner, prepared, at_version=2)
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_decision"):
        confirm(owner, prepared, decision="approve")
    with owner.factory.begin() as db:
        other = Account(name="Teammate", email="teammate@example.invalid")
        db.add(other)
        db.flush()
        db.add(TenantAccountJoin(tenant_id=owner.actor.tenant_id, account_id=other.id, role=TenantAccountRole.ADMIN))
        stranger = Actor(account_id=other.id, tenant_id=owner.actor.tenant_id)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_found"):
        confirm(owner, prepared, actor=stranger)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_found"):
        get(owner, prepared.consent_id, actor=stranger)
    row = owner.consent_row(prepared.consent_id)
    assert (row.state, row.confirm_key, row.decision) == ("prepared", None, None)
    decision = confirm(owner, prepared)
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        confirm(owner, prepared, decision="decline")
    with pytest.raises(BuilderExecutionPolicyError, match="consent_decision_conflict"):
        confirm(owner, prepared, idempotency_key="decline-1", decision="decline")
    assert get(owner, prepared.consent_id) == decision


def test_decline_is_terminal_and_never_reserves(consent_owner: Owner) -> None:
    owner = consent_owner
    prepared = prepare(owner)
    declined = confirm(owner, prepared, decision="decline")
    assert (declined.state, declined.can_retry) == ("declined", True)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_confirmed"):
        reserve(owner, prepared)
    assert owner.count(DifyBuilderExecutionRequest) == 0
    assert confirm(owner, prepared, decision="decline") == declined


@pytest.mark.parametrize("change", ["rotation", "client", "graph", "input", "partial_revoke", "scope_key"])
def test_scope_change_before_confirm_invalidates(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    owner = consent_owner
    if change == "partial_revoke":
        with owner.factory.begin() as db:
            other = Account(name="Credential owner", email="credential-owner@example.invalid")
            db.add(other)
            db.flush()
            db.add(
                TenantAccountJoin(tenant_id=owner.actor.tenant_id, account_id=other.id, role=TenantAccountRole.ADMIN)
            )
            row = db.get(BuiltinToolProvider, owner.credential_id)
            assert row is not None
            row.user_id, row.visibility = other.id, PermissionEnum.PARTIAL_TEAM
            db.add(
                CredentialPermission(
                    credential_id=owner.credential_id,
                    credential_type=CredentialPermissionType.BUILTIN_TOOL_PROVIDER,
                    account_id=owner.actor.account_id,
                    tenant_id=owner.actor.tenant_id,
                    has_permission=True,
                )
            )
    prepared = prepare(owner)
    if change == "rotation":
        # Same timestamp; only ciphertext changes.
        update_credential(owner, encrypted_credentials='{"access_token":"rotated-elsewhere"}')
    elif change == "client":
        with owner.factory.begin() as db:
            client = db.get(ToolOAuthTenantClient, owner.client_id)
            assert client is not None
            client.encrypted_oauth_params = '{"client_id":"replaced"}'
    elif change == "graph":
        with owner.factory.begin() as db:
            workflow = db.get(Workflow, owner.workflow_id)
            assert workflow is not None
            graph = json.loads(workflow.graph)
            graph["nodes"][1]["data"]["tool_parameters"]["include_body"]["value"] = True
            workflow.graph = json.dumps(graph)
    elif change == "input":
        with owner.factory.begin() as db:
            test_input = db.get(DifyBuilderTestInput, owner.test_input_id)
            assert test_input is not None
            test_input.inputs = {"note": "changed"}
    elif change == "partial_revoke":
        with owner.factory.begin() as db:
            grant = db.scalar(select(CredentialPermission))
            assert grant is not None
            db.delete(grant)
    elif change == "scope_key":
        monkeypatch.setattr(dify_config, "SECRET_KEY", "rotated-consent-secret")
    with pytest.raises(BuilderExecutionPolicyError):
        confirm(owner, prepared)
    current = get(owner, prepared.consent_id)
    assert (current.state, current.can_retry) == ("invalidated", True)
    assert current.reason_code is not None
    with pytest.raises(BuilderExecutionPolicyError, match="consent_not_confirmed"):
        reserve(owner, prepared)
    assert owner.count(DifyBuilderExecutionRequest) == 0
    if change != "partial_revoke":  # the revoked actor can no longer derive the reference
        assert_public(current, owner=owner)


def test_unrelated_session_commit_invalidates_unlaunched_consent(consent_owner: Owner) -> None:
    owner = consent_owner
    prepared = prepare(owner)
    repo = SqlDifyBuilderRepository(owner.factory)
    _session, fc = repo.get_session(owner.session_id)
    repo.compare_and_advance(owner.session_id, 1, PcState.BUILD_AWAIT_TESTDATA, fc, [])
    with pytest.raises(BuilderExecutionPolicyError, match="consent_invalidated"):
        confirm(owner, prepared)
    assert get(owner, prepared.consent_id).state == "invalidated"


def test_expired_consent_cannot_be_confirmed(consent_owner: Owner, monkeypatch: pytest.MonkeyPatch) -> None:
    owner = consent_owner
    prepared = prepare(owner)
    shift_clock(monkeypatch, timedelta(minutes=10, seconds=1))
    assert get(owner, prepared.consent_id).state == "expired"
    with pytest.raises(BuilderExecutionPolicyError, match="consent_expired"):
        confirm(owner, prepared)
    expired = get(owner, prepared.consent_id)
    assert (expired.state, expired.reason_code, expired.can_retry) == ("expired", "consent_expired", True)


# --- reservation -------------------------------------------------------------------------


def test_reservation_atomically_commits_command_sidecar_and_session_version(consent_owner: Owner) -> None:
    owner = consent_owner
    decision = confirm(owner, prepare(owner))
    reserved, won = reserve(owner, decision)
    assert won is True
    assert (reserved.state, reserved.at_version, reserved.can_retry) == ("confirmed", 2, False)
    assert reserved.command_id is not None
    assert reserved.execution_request_id is not None
    session, fc = SqlDifyBuilderRepository(owner.factory).get_session(owner.session_id)
    assert (session.version, session.current_state) == (2, PcState.BUILD_TEST_AND_REPAIR)
    assert (fc.last_command_id, fc.test_input_ref) == (reserved.command_id, owner.test_input_id)
    with owner.factory() as db:
        request = db.get(DifyBuilderExecutionRequest, reserved.execution_request_id)
        assert request is not None
        assert request.state == "prepared"
        context = validate_execution_context(request.context)
        commit = db.scalar(
            select(DifyBuilderSessionCommit).where(
                DifyBuilderSessionCommit.session_id == owner.session_id, DifyBuilderSessionCommit.version == 2
            )
        )
        assert commit is not None
    assert isinstance(context, ConfirmedToolExecutionContext)
    assert (context.consent_id, context.scope_digest, context.command_id, context.request_id) == (
        reserved.consent_id,
        reserved.scope_digest,
        reserved.command_id,
        reserved.execution_request_id,
    )
    assert (context.mode, context.sandbox_profile, context.test_input_id) == (
        "confirmed_tool",
        "disabled",
        owner.test_input_id,
    )
    assert [node.node_id for node in context.admitted_nodes] == ["start", "tool", "end"]
    row = owner.consent_row(reserved.consent_id)
    assert (row.reserved_version, row.reserved_commit_id, row.command_id) == (2, commit.id, reserved.command_id)
    assert row.execute_receipt == reserved.model_dump(mode="json")
    # Lost acknowledgement: the identical request replays the saved receipt, never a second launch.
    assert reserve(owner, decision) == (reserved, False)
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        reserve(owner, decision, idempotency_key="execute-2")
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        reserve(owner, decision, scope_digest="b" * 64)
    assert owner.count(DifyBuilderExecutionRequest) == 1
    assert owner.count(DifyBuilderSessionCommit) == 2
    assert get(owner, reserved.consent_id) == reserved
    assert_public(reserved, owner=owner)


def test_reservation_rolls_back_every_write_on_session_cas_conflict(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    decision = confirm(owner, prepare(owner))
    original = SqlDifyBuilderRepository._compare_and_advance_in_session

    def lose_race(
        self: SqlDifyBuilderRepository,
        db: Session,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: DifyBuilderContext,
        items: list[ConversationItem],
    ) -> int:
        original(self, db, session_id, base_version, next, fc, items)
        raise ConflictError("lost race")

    monkeypatch.setattr(SqlDifyBuilderRepository, "_compare_and_advance_in_session", lose_race)
    with pytest.raises(BuilderExecutionPolicyError, match="stale_session_version"):
        reserve(owner, decision)
    assert owner.count(DifyBuilderExecutionRequest) == 0
    assert owner.count(DifyBuilderSessionCommit) == 1
    row = owner.consent_row(decision.consent_id)
    assert (row.state, row.command_id, row.execute_key, row.reserved_version) == ("confirmed", None, None, None)
    monkeypatch.setattr(SqlDifyBuilderRepository, "_compare_and_advance_in_session", original)
    assert reserve(owner, decision)[1] is True


@pytest.mark.parametrize("gate", ["paused", "recovery", "staged_repair"])
def test_reservation_refuses_blocked_session_without_mutation(consent_owner: Owner, gate: str) -> None:
    owner = consent_owner
    decision = confirm(owner, prepare(owner))
    with owner.factory.begin() as db:
        commit = db.scalar(
            select(DifyBuilderSessionCommit).where(DifyBuilderSessionCommit.session_id == owner.session_id)
        )
        assert commit is not None
        fc = context_from_dict(commit.context)
        if gate == "paused":
            fc.paused = True
        elif gate == "recovery":
            fc.recovery_class = "draft_changed"
        else:
            fc.staged_repair = [MutationIntent(op="set_node_config", args={})]
        commit.context = context_to_dict(fc)
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_session_state"):
        reserve(owner, decision)
    assert owner.count(DifyBuilderExecutionRequest) == 0
    assert owner.consent_row(decision.consent_id).command_id is None


# --- grant and phase claims --------------------------------------------------------------


def test_tool_claim_is_permanent_across_service_instances(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    assert (binding.node_id, binding.native_node_execution_id) == ("tool", "node-execution-1")
    assert binding.context.consent_id == reserved.consent_id
    current = get(owner, reserved.consent_id)
    assert (current.state, current.can_retry, current.native_run_id) == ("claimed", False, binding.native_run_id)
    for service in (owner.service(), service_module().BuilderRealCallConsentService(owner.factory)):
        with pytest.raises(BuilderExecutionPolicyError, match="consent_already_claimed"):
            service.claim_tool(
                context=binding.context,
                node_id="tool",
                native_run_id=binding.native_run_id,
                native_node_execution_id="node-execution-2",
            )
    assert owner.consent_row(reserved.consent_id).native_node_execution_id == "node-execution-1"


@pytest.mark.parametrize("forgery", ["node", "run", "consent", "scope", "unlaunched"])
def test_tool_claim_rejects_forged_identity_without_spending(consent_owner: Owner, forgery: str) -> None:
    owner = consent_owner
    reserved, won = reserve(owner, confirm(owner, prepare(owner)))
    assert won is True
    node_id, native_run_id = "tool", str(uuid4())
    if forgery == "unlaunched":
        with owner.factory() as db:
            request = db.get(DifyBuilderExecutionRequest, reserved.execution_request_id)
            assert request is not None
            context = validate_execution_context(request.context)
    else:
        context, native_run_id = simulate_task6_launch(owner, reserved)
    assert isinstance(context, ConfirmedToolExecutionContext)
    if forgery == "node":
        node_id = "end"
    elif forgery == "run":
        native_run_id = str(uuid4())
    elif forgery in {"consent", "scope"}:
        field = "consent_id" if forgery == "consent" else "scope_digest"
        context = context.model_copy(update={field: str(uuid4()) if forgery == "consent" else "c" * 64})
        # A self-consistent digest: only the durable sidecar/consent binding can refuse it.
        context = context.model_copy(update={"context_digest": context_digest(context)})
    with pytest.raises(BuilderExecutionPolicyError):
        owner.service().claim_tool(
            context=context, node_id=node_id, native_run_id=native_run_id, native_node_execution_id="node-execution-1"
        )
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.claimed_at) == ("confirmed", None)


def test_expired_reservation_cannot_claim(consent_owner: Owner, monkeypatch: pytest.MonkeyPatch) -> None:
    owner = consent_owner
    reserved, _won = reserve(owner, confirm(owner, prepare(owner)))
    context, run_id = simulate_task6_launch(owner, reserved)
    shift_clock(monkeypatch, timedelta(minutes=10, seconds=1))
    with pytest.raises(BuilderExecutionPolicyError, match="consent_expired"):
        owner.service().claim_tool(
            context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution-1"
        )
    current = get(owner, reserved.consent_id)
    assert (current.state, current.can_retry, current.business_claimed) == ("expired", False, False)


def test_refresh_and_business_phases_spend_once_with_full_reference_cas(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    service = owner.service()
    initial = owner.full_reference_revision()
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_phase_input"):
        service.claim_phase(binding=binding, phase="refresh", final_parameters=APPROVED)
    service.claim_phase(binding=binding, phase="refresh", final_parameters=None)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_already_claimed"):
        service.claim_phase(binding=binding, phase="refresh", final_parameters=None)
    derived = service.finish_refresh(
        binding=binding,
        old_revision=initial,
        encrypted_credentials='{"access_token":"enc-new"}',
        expires_at=1_900_003_600,
    )
    assert derived == owner.full_reference_revision() != initial
    with owner.factory() as db:
        credential = db.get(BuiltinToolProvider, owner.credential_id)
        assert credential is not None
        assert (credential.encrypted_credentials, credential.expires_at) == (
            '{"access_token":"enc-new"}',
            1_900_003_600,
        )
    service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_already_claimed"):
        service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    row = owner.consent_row(reserved.consent_id)
    assert (row.refresh_count, row.business_count) == (1, 1)
    assert (row.initial_credential_revision, row.derived_credential_revision) == (initial, derived)
    current = get(owner, reserved.consent_id)
    assert (current.refresh_claimed, current.business_claimed, current.can_retry) == (True, True, False)
    assert_public(current, owner=owner)
    assert derived not in json.dumps(current.model_dump(mode="json"))


def test_refresh_cas_conflict_is_unknown_and_never_overwrites_rotation(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    service = owner.service()
    initial = owner.full_reference_revision()
    service.claim_phase(binding=binding, phase="refresh", final_parameters=None)
    update_credential(owner, encrypted_credentials='{"access_token":"rotated-elsewhere"}')
    with pytest.raises(BuilderExecutionPolicyError, match="refresh_conflict"):
        service.finish_refresh(
            binding=binding, old_revision=initial, encrypted_credentials='{"access_token":"enc-new"}', expires_at=1
        )
    with owner.factory() as db:
        credential = db.get(BuiltinToolProvider, owner.credential_id)
        assert credential is not None
        assert (credential.encrypted_credentials, credential.expires_at) == (
            '{"access_token":"rotated-elsewhere"}',
            1_900_000_000,
        )
    current = get(owner, reserved.consent_id)
    assert (current.state, current.reason_code, current.can_retry) == ("unknown", "refresh_conflict", False)
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    assert owner.consent_row(reserved.consent_id).business_count == 0
    assert get(owner, reserved.consent_id).state == "unknown"


def test_unresolved_refresh_blocks_business_as_unknown(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    owner.service().claim_phase(binding=binding, phase="refresh", final_parameters=None)
    with pytest.raises(BuilderExecutionPolicyError, match="refresh_uncertain"):
        owner.service().claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    current = get(owner, reserved.consent_id)
    assert (current.state, current.business_claimed) == ("unknown", False)


@pytest.mark.parametrize("change", ["rotation", "parameters", "expiry", "permission"])
def test_known_pre_phase_denial_after_claim_is_failed(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    parameters = APPROVED
    if change == "rotation":
        update_credential(owner, encrypted_credentials='{"access_token":"rotated-elsewhere"}')
    elif change == "parameters":
        parameters = APPROVED.model_copy(update={"include_body": True})
    elif change == "expiry":
        shift_clock(monkeypatch, timedelta(minutes=10, seconds=1))
    else:
        from services.enterprise.rbac_service import RBACService

        monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
        monkeypatch.setattr(RBACService.CheckAccess, "check", lambda *_args, **_kwargs: False)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.service().claim_phase(binding=binding, phase="business", final_parameters=parameters)
    current = get(owner, reserved.consent_id) if change != "permission" else None
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.business_count, row.business_claimed_at) == ("failed", 0, None)
    assert row.reason_code is not None
    if current is not None:
        assert (current.state, current.can_retry) == ("failed", False)


def test_expiry_blocks_new_phase_but_permits_recording_dispatched_outcome(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    owner.service().claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    shift_clock(monkeypatch, timedelta(minutes=30))
    owner.service().finish(binding=binding, outcome=ActionOutcome(state="completed", reason_code="message_returned"))
    row = owner.consent_row(reserved.consent_id)
    # A completed candidate stays claimed until Task 6 seals actual native Run proof.
    assert (row.state, row.outcome_state, row.reason_code) == ("claimed", "completed", "message_returned")
    current = get(owner, reserved.consent_id)
    assert (current.state, current.business_claimed, current.reason_code) == ("claimed", True, "message_returned")


def test_outcome_candidates_and_unknown_finality(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    service = owner.service()
    with pytest.raises(BuilderExecutionPolicyError, match="phase_not_claimed"):
        service.finish(binding=binding, outcome=ActionOutcome(state="completed", reason_code="message_returned"))
    service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    completed = ActionOutcome(state="completed", reason_code="message_returned")
    service.finish(binding=binding, outcome=completed)
    service.finish(binding=binding, outcome=completed)
    with pytest.raises(BuilderExecutionPolicyError, match="consent_outcome_conflict"):
        service.finish(binding=binding, outcome=ActionOutcome(state="failed", reason_code="declared_failure"))
    service.finish(binding=binding, outcome=ActionOutcome(state="unknown", reason_code="seal_mismatch"))
    assert get(owner, reserved.consent_id).state == "unknown"
    with pytest.raises(BuilderExecutionPolicyError, match="consent_outcome_final"):
        service.finish(binding=binding, outcome=completed)
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.outcome_state, row.reason_code) == ("unknown", "unknown", "seal_mismatch")
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_phase(binding=binding, phase="refresh", final_parameters=None)
    assert owner.consent_row(reserved.consent_id).refresh_count == 0


def test_phase_and_finish_reject_forged_binding(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, binding = claimed(owner)
    forged: list[ConfirmedToolBinding] = [
        binding.model_copy(update={"native_run_id": str(uuid4())}),
        binding.model_copy(update={"native_node_execution_id": "other-node-execution"}),
        binding.model_copy(update={"node_id": "end"}),
    ]
    for candidate in forged:
        with pytest.raises(BuilderExecutionPolicyError):
            owner.service().claim_phase(binding=candidate, phase="business", final_parameters=APPROVED)
        with pytest.raises(BuilderExecutionPolicyError):
            owner.service().finish(binding=candidate, outcome=ActionOutcome(state="unknown", reason_code="x"))
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.business_count, row.outcome_state) == ("claimed", 0, None)


# --- correction 1: narrow context reference, current execute replay, pre-SQL ID refusal ------


def latest_context(owner: Owner) -> DifyBuilderContext:
    return SqlDifyBuilderRepository(owner.factory).get_session(owner.session_id)[1]


def test_reservation_persists_narrow_consent_reference_in_the_same_commit(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, won = reserve(owner, confirm(owner, prepare(owner)))
    assert won is True
    with owner.factory() as db:
        commits = {
            commit.version: commit
            for commit in db.scalars(
                select(DifyBuilderSessionCommit).where(DifyBuilderSessionCommit.session_id == owner.session_id)
            )
        }
    assert set(commits) == {1, 2}
    reserved_context = context_from_dict(commits[2].context)
    # One commit carries the command, the input and the exact consent reference together.
    assert (
        reserved_context.last_command_id,
        reserved_context.test_input_ref,
        reserved_context.confirmed_consent_id,
        reserved_context.confirmed_command_id,
    ) == (reserved.command_id, owner.test_input_id, reserved.consent_id, reserved.command_id)
    assert (commits[2].context["confirmed_consent_id"], commits[2].context["confirmed_command_id"]) == (
        reserved.consent_id,
        reserved.command_id,
    )
    # The prepared commit is immutable history and never gains the reference.
    assert (commits[1].context["confirmed_consent_id"], commits[1].context["confirmed_command_id"]) == ("", "")
    assert owner.consent_row(reserved.consent_id).reserved_commit_id == commits[2].id


def test_context_reference_roundtrips_and_old_rows_default_empty() -> None:
    fresh = DifyBuilderContext(confirmed_consent_id="consent-1", confirmed_command_id="command-1")
    loaded = context_from_dict(context_to_dict(fresh))
    assert (loaded.confirmed_consent_id, loaded.confirmed_command_id) == ("consent-1", "command-1")
    legacy = context_to_dict(DifyBuilderContext(last_command_id="older"))
    del legacy["confirmed_consent_id"], legacy["confirmed_command_id"]
    old = context_from_dict(legacy)
    assert (old.last_command_id, old.confirmed_consent_id, old.confirmed_command_id) == ("older", "", "")
    assert context_from_dict({}).confirmed_command_id == ""
    # Discovery data never stands in for the reference.
    assert context_from_dict({"resource_selection": {"confirmed_consent_id": "x"}}).confirmed_consent_id == ""


@pytest.mark.parametrize("field", ["confirmed_consent_id", "confirmed_command_id"])
def test_claim_requires_exact_reserved_context_reference(consent_owner: Owner, field: str) -> None:
    owner = consent_owner
    reserved, won = reserve(owner, confirm(owner, prepare(owner)))
    assert won is True
    context, run_id = simulate_task6_launch(owner, reserved)
    repo = SqlDifyBuilderRepository(owner.factory)
    session, fc = repo.get_session(owner.session_id)
    setattr(fc, field, str(uuid4()))  # a later commit of the same command that drops/changes the reference
    repo.compare_and_advance(owner.session_id, session.version, session.current_state, fc, [])
    with pytest.raises(BuilderExecutionPolicyError, match="consent_scope_changed"):
        owner.service().claim_tool(
            context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution-1"
        )
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.reason_code, row.claimed_at) == ("invalidated", "command_lineage_changed", None)


def test_execute_replay_returns_current_state_after_business_and_unknown(consent_owner: Owner) -> None:
    owner = consent_owner
    prepared = prepare(owner)
    decision = confirm(owner, prepared)
    reserved, won = reserve(owner, decision)
    assert won is True
    context, run_id = simulate_task6_launch(owner, reserved)
    binding = owner.service().claim_tool(
        context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution-1"
    )
    owner.service().claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    executed, again = reserve(owner, decision)
    assert again is False
    assert (executed.state, executed.business_claimed, executed.native_run_id) == ("claimed", True, run_id)
    assert (executed.command_id, executed.execution_request_id) == (reserved.command_id, reserved.execution_request_id)
    owner.service().finish(binding=binding, outcome=ActionOutcome(state="unknown", reason_code="stream_incomplete"))
    uncertain, again = reserve(owner, decision)
    assert again is False
    assert (uncertain.state, uncertain.reason_code, uncertain.can_retry) == ("unknown", "stream_incomplete", False)
    assert (uncertain.command_id, uncertain.execution_request_id) == (
        reserved.command_id,
        reserved.execution_request_id,
    )
    assert uncertain == get(owner, reserved.consent_id)
    # Idempotency metadata and the original audit receipt are kept; body/key checks still apply.
    row = owner.consent_row(reserved.consent_id)
    assert (row.execute_key, row.execute_receipt) == ("execute-1", reserved.model_dump(mode="json"))
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        reserve(owner, decision, scope_digest="b" * 64)
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        reserve(owner, decision, idempotency_key="execute-2")
    # The decision replay stays the original saved decision receipt.
    assert confirm(owner, prepared) == decision
    assert owner.count(DifyBuilderExecutionRequest) == 1
    assert owner.count(DifyBuilderSessionCommit) == 2


MALFORMED_IDS = ["", "not-a-uuid", "{00000000-0000-4000-8000-000000000000}", " " * 36, "A" * 36]


@pytest.mark.parametrize("malformed", MALFORMED_IDS)
@pytest.mark.parametrize(
    ("operation", "reason"),
    [
        ("prepare_session", "execution_owner_mismatch"),
        ("prepare_test_input", "execution_owner_mismatch"),
        ("prepare_credential", "credential_reference_unavailable"),
        ("prepare_upper_session", "execution_owner_mismatch"),
        ("confirm_consent", "consent_not_found"),
        ("confirm_session", "consent_not_found"),
        ("reserve_consent", "consent_not_found"),
        ("reserve_session", "consent_not_found"),
        ("get_consent", "consent_not_found"),
        ("get_session", "consent_not_found"),
    ],
)
def test_malformed_public_ids_refuse_before_any_sql(
    consent_owner: Owner, operation: str, reason: str, malformed: str
) -> None:
    owner = consent_owner
    revision = owner.revision()
    valid = str(uuid4())
    service = owner.service()
    engine = owner.factory.kw["bind"]
    statements: list[str] = []

    def spy(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    def direct_prepare(**changes: str) -> object:
        # Direct call: the module helper reads the draft revision through SQL.
        values = {
            "session_id": owner.session_id,
            "test_input_id": owner.test_input_id,
            "credential_id": owner.credential_id,
            **changes,
        }
        return service.prepare(
            actor=owner.actor,
            node_id="tool",
            at_version=1,
            base_app_revision=revision,
            idempotency_key="k",
            **values,
        )

    calls: dict[str, Callable[[], object]] = {
        "prepare_session": lambda: direct_prepare(session_id=malformed),
        "prepare_test_input": lambda: direct_prepare(test_input_id=malformed),
        "prepare_credential": lambda: direct_prepare(credential_id=malformed),
        "prepare_upper_session": lambda: direct_prepare(session_id=owner.session_id.upper()),
        "confirm_consent": lambda: service.confirm(
            actor=owner.actor,
            session_id=owner.session_id,
            consent_id=malformed,
            decision="confirm",
            scope_digest="a" * 64,
            at_version=1,
            idempotency_key="k",
        ),
        "confirm_session": lambda: service.confirm(
            actor=owner.actor,
            session_id=malformed,
            consent_id=valid,
            decision="decline",
            scope_digest="a" * 64,
            at_version=1,
            idempotency_key="k",
        ),
        "reserve_consent": lambda: service.reserve_execution(
            actor=owner.actor,
            session_id=owner.session_id,
            consent_id=malformed,
            scope_digest="a" * 64,
            at_version=1,
            idempotency_key="k",
        ),
        "reserve_session": lambda: service.reserve_execution(
            actor=owner.actor,
            session_id=malformed,
            consent_id=valid,
            scope_digest="a" * 64,
            at_version=1,
            idempotency_key="k",
        ),
        "get_consent": lambda: service.get(actor=owner.actor, session_id=owner.session_id, consent_id=malformed),
        "get_session": lambda: service.get(actor=owner.actor, session_id=malformed, consent_id=valid),
    }
    event.listen(engine, "before_cursor_execute", spy)
    try:
        with pytest.raises(BuilderExecutionPolicyError, match=reason):
            calls[operation]()
    finally:
        event.remove(engine, "before_cursor_execute", spy)
    assert statements == []
