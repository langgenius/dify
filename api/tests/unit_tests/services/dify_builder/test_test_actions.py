"""The existing action transport must retain native command scope and identity."""

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Literal, Never

import pytest
from pydantic import ValidationError
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker

from controllers.console.dify_builder_fields import DifyBuilderSessionViewResponse, DifyBuilderSubmitActionPayload
from core.dify_builder.contract import SessionView
from core.dify_builder.models import Actor
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from services.dify_builder.test_actions import TestCommand as NativeCommand
from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock


def test_action_accepts_stable_client_identity_without_changing_old_requests() -> None:
    empty_payload: dict[str, object] = {}
    old = {"action_id": "run_test", "payload": empty_payload, "base_version": 3, "base_app_revision": "revision"}
    assert DifyBuilderSubmitActionPayload.model_validate(old).client_action_id is None
    parsed = DifyBuilderSubmitActionPayload.model_validate({**old, "client_action_id": "attempt-1"})
    assert parsed.client_action_id == "attempt-1"


@pytest.mark.parametrize("value", ["", "a" * 129, 42])
def test_action_rejects_invalid_client_identity(value: object) -> None:
    with pytest.raises(ValidationError):
        DifyBuilderSubmitActionPayload.model_validate(
            {"action_id": "run_test", "base_version": 3, "base_app_revision": "revision", "client_action_id": value}
        )


def test_risk_action_preserves_pending_version_and_explicit_target() -> None:
    from services.dify_builder.test_actions import parse_test_action

    command = parse_test_action(
        "confirm_test_operation",
        {
            "request_id": "request-1",
            "pending_operation_id": "operation-2",
            "pending_version": 4,
            "scope_digest": "a" * 64,
        },
    )
    assert command.request_id == "request-1"
    assert command.native_payload == {
        "pending_operation_id": "operation-2",
        "expected_version": 4,
        "scope_digest": "a" * 64,
        "decision": "confirm",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"request_id": "r", "pending_operation_id": "p", "pending_version": True, "scope_digest": "a" * 64},
        {"request_id": "r", "pending_operation_id": "p", "pending_version": 1, "scope_digest": "wrong"},
        {
            "request_id": "r",
            "pending_operation_id": "p",
            "pending_version": 1,
            "scope_digest": "a" * 64,
            "permit": "forged",
        },
    ],
)
def test_risk_action_rejects_forged_or_coerced_authority(payload: dict[str, object]) -> None:
    from core.dify_builder.errors import BadRequestError
    from services.dify_builder.test_actions import parse_test_action

    with pytest.raises(BadRequestError):
        parse_test_action("confirm_test_operation", payload)


def test_resume_keeps_original_request_and_generation() -> None:
    from services.dify_builder.test_actions import parse_test_action

    command = parse_test_action("resume_test", {"request_id": "request-1", "expected_generation": 2})
    assert command.method == "resume"
    assert command.request_id == "request-1"
    assert command.native_payload == {"expected_generation": 2}


@dataclass
class ActionCommands:
    repo: SqlDifyBuilderRepository
    lock: FakeSessionLock
    commands: list[tuple[NativeCommand, str]] = field(default_factory=list)
    receipt: NativeTestPublicReceipt = field(
        default_factory=lambda: NativeTestPublicReceipt(
            request_id="request-1",
            generation=0,
            version=1,
            status="waiting",
            wait_reason="approval",
            native_run_id="run-1",
            native_status="paused",
            pending=(),
            outcome=None,
            evidence_refs=(),
            can_resume=True,
            resume_blocked_reason=None,
        )
    )

    def find_command(self, *, actor: Actor, session_id: str, command_id: str) -> dict[str, object] | None:
        assert actor.account_id
        return next(
            (
                item.payload
                for item in self.repo.list_conversation(session_id)
                if item.payload.get("test_command_id") == command_id
            ),
            None,
        )

    def settle(self, *, actor: Actor, session_id: str, request_id: str) -> None:
        assert actor.account_id
        assert request_id
        assert not self.lock.exists(session_id)

    def current(self, *, actor: Actor, session_id: str, test_input_id: str) -> NativeTestPublicReceipt | None:
        assert actor.account_id
        assert session_id
        return self.receipt if test_input_id == "input-1" else None

    def current_request_id(self, *, actor: Actor, session_id: str, test_input_id: str) -> str | None:
        assert actor.account_id
        assert session_id
        return self.receipt.request_id if test_input_id == "input-1" else None

    def observation_initializing(self, *, actor: Actor, session_id: str, test_input_id: str) -> bool:
        assert actor.account_id
        assert session_id
        assert test_input_id
        return False

    def current_diagnostics(
        self, *, actor: Actor, session_id: str, test_input_id: str, receipt: NativeTestPublicReceipt
    ) -> list[dict[str, object]]:
        assert actor.account_id
        assert session_id
        assert test_input_id
        assert receipt.request_id
        return []

    def execute(
        self, *, actor: Actor, session_id: str, test_input_id: str, command: NativeCommand, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        assert actor.account_id
        assert session_id
        assert test_input_id == "input-1"
        self.commands.append((command, idempotency_key))
        return self.receipt


type ActionCase = tuple[DifyBuilderService, Actor, str, SqlDifyBuilderRepository, ActionCommands, FakeSessionLock]


@pytest.fixture
def action_case() -> Iterator[ActionCase]:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, Session
    from core.dify_builder.state import PcState
    from models.base import Base
    from services.dify_builder.repository import SqlDifyBuilderRepository
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repo = SqlDifyBuilderRepository(sessionmaker(bind=engine, expire_on_commit=False))
    actor = Actor(account_id="33333333-3333-3333-3333-333333333333", tenant_id="11111111-1111-1111-1111-111111111111")
    session = Session(
        app_id="22222222-2222-2222-2222-222222222222",
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_AWAIT_REPAIR,
    )
    repo.create_session(session, DifyBuilderContext(test_input_ref="input-1"), [])

    lock = FakeSessionLock()
    commands = ActionCommands(repo=repo, lock=lock)
    svc = DifyBuilderService(
        repo,
        lock,
        lambda *_: pytest.fail("native controls must not enqueue a new Builder run"),
        get_app_revision_fn=lambda *_: "revision",
        test_actions=commands,
    )
    try:
        yield svc, actor, session.id, repo, commands, lock
    finally:
        engine.dispose()


def test_session_projects_test_state_without_starting_another_run(action_case: ActionCase) -> None:
    svc, actor, sid, _, commands, _ = action_case
    view = svc.get_session_view(sid, actor)
    assert view.test_execution is not None
    assert view.test_execution["request_id"] == "request-1"
    assert {a.id for a in view.actions} == {"resume_test", "cancel_test"}
    assert commands.commands == []


def test_resume_action_preserves_request_and_finishes_on_existing_transport(action_case: ActionCase) -> None:
    from core.dify_builder.models import Action

    svc, actor, sid, _, commands, _ = action_case
    view = svc.get_session_view(sid, actor)
    action = Action(
        kind="resume_test",
        payload={"request_id": "request-1", "expected_generation": 0},
        base_version=view.version,
        base_app_revision="revision",
        command_id="stable-command",
    )
    frames = list(svc.submit_action_stream(sid, actor, action))
    assert len(commands.commands) == 1
    assert commands.commands[0][0].request_id == "request-1"
    assert any('"event": "command_finished"' in frame for frame in frames)
    assert any('"test_execution"' in frame for frame in frames)


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("resume_test", {"request_id": "request-1", "expected_generation": 0}),
        (
            "confirm_test_operation",
            {"request_id": "request-1", "pending_operation_id": "p1", "pending_version": 1, "scope_digest": "a" * 64},
        ),
    ],
)
def test_native_command_projects_private_disclosure_only_after_execution(
    action_case: ActionCase, mocker: MockerFixture, kind: str, payload: dict[str, object]
) -> None:
    """The command owner already validates authority; the view must still be fresh."""
    from core.dify_builder.models import Action

    svc, actor, sid, repo, commands, _ = action_case
    session, _ = repo.get_session(sid)
    events: list[str] = []
    original_current, original_execute = commands.current, commands.execute

    def current(*, actor: Actor, session_id: str, test_input_id: str) -> NativeTestPublicReceipt | None:
        events.append("disclosure")
        return original_current(actor=actor, session_id=session_id, test_input_id=test_input_id)

    def execute(
        *, actor: Actor, session_id: str, test_input_id: str, command: NativeCommand, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        events.append("command")
        return original_execute(
            actor=actor,
            session_id=session_id,
            test_input_id=test_input_id,
            command=command,
            idempotency_key=idempotency_key,
        )

    mocker.patch.object(commands, "current", side_effect=current)
    mocker.patch.object(commands, "execute", side_effect=execute)
    frames = list(
        svc.submit_action_stream(
            sid,
            actor,
            Action(kind=kind, payload=payload, base_version=session.version, base_app_revision="revision"),
        )
    )
    assert events == ["command", "disclosure"]
    assert len(commands.commands) == 1
    assert any('"test_execution"' in frame for frame in frames)


@pytest.mark.parametrize("method", ["decide", "resume", "cancel"])
def test_native_command_keeps_owner_authorization_after_metadata_check(
    action_case: ActionCase,
    sqlite_session_factory: sessionmaker[SqlSession],
    mocker: MockerFixture,
    method: Literal["decide", "resume", "cancel"],
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands
    from services.dify_builder.test_actions import BuilderTestActions

    _, actor, sid, _, _, _ = action_case

    def unexpected_profile() -> Never:
        pytest.fail("the patched command must enforce its own authorization")

    command_owner = ProfiledNativeTestCommands(
        sessions=sqlite_session_factory,
        actor=actor,
        confirmed_factory=unexpected_profile,
        legacy_factory=unexpected_profile,
    )
    selected = mocker.patch.object(
        command_owner, method, side_effect=BuilderExecutionPolicyError("execution_permission_denied")
    )

    def factory(*, actor: Actor) -> ProfiledNativeTestCommands:
        assert actor == command_owner.actor
        return command_owner

    actions = BuilderTestActions(sqlite_session_factory, factory)
    mocker.patch.object(actions, "_current_id", return_value="request-1")
    with pytest.raises(BuilderExecutionPolicyError, match="execution_permission_denied"):
        actions.execute(
            actor=actor,
            session_id=sid,
            test_input_id="input-1",
            command=NativeCommand(method, "request-1", {}),
            idempotency_key="command-1",
        )
    selected.assert_called_once_with(actor=actor, session_id=sid, request_id="request-1", idempotency_key="command-1")


def test_native_metadata_read_does_not_construct_private_command_owner(
    action_case: ActionCase, sqlite_session_factory: sessionmaker[SqlSession], mocker: MockerFixture
) -> None:
    from services.dify_builder.test_actions import BuilderTestActions

    _, actor, sid, _, _, _ = action_case

    def factory(**_owners: Actor) -> Never:
        pytest.fail("metadata read must not compose private disclosure")

    actions = BuilderTestActions(sqlite_session_factory, factory)
    selected = mocker.patch.object(actions, "_current_id", return_value="request-1")
    assert actions.current_request_id(actor=actor, session_id=sid, test_input_id="input-1") == "request-1"
    selected.assert_called_once_with(actor=actor, session_id=sid, test_input_id="input-1")


def test_native_metadata_read_selects_only_current_owned_input(
    sqlite_session_factory: sessionmaker[SqlSession],
) -> None:
    from datetime import datetime, timedelta

    from core.dify_builder.errors import ConflictError
    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.test_actions import BuilderTestActions

    actor = Actor(account_id="33333333-3333-3333-3333-333333333333", tenant_id="11111111-1111-1111-1111-111111111111")
    sid, input_id = "44444444-4444-4444-4444-444444444444", "55555555-5555-5555-5555-555555555555"
    at = datetime(2026, 10, 28)
    ids = [f"00000000-0000-0000-0000-{i:012d}" for i in range(1, 6)]
    with sqlite_session_factory.begin() as sql:
        for index, request_id in enumerate(ids):
            sql.add(
                DifyBuilderExecutionRequest(
                    id=request_id,
                    tenant_id=actor.tenant_id,
                    actor_id=actor.account_id if index != 2 else "66666666-6666-6666-6666-666666666666",
                    app_id="22222222-2222-2222-2222-222222222222",
                    workflow_id="77777777-7777-7777-7777-777777777777",
                    session_id=sid if index != 3 else "88888888-8888-8888-8888-888888888888",
                    test_input_id=input_id if index != 4 else "99999999-9999-9999-9999-999999999999",
                    context={"policy_version": "builder-native-test-v1"},
                    context_digest="a" * 64,
                    created_at=at + timedelta(seconds=index),
                )
            )

    def factory(**_owners: Actor) -> Never:
        pytest.fail("metadata read must not fetch private objects")

    actions = BuilderTestActions(sqlite_session_factory, factory)
    assert actions.current_request_id(actor=actor, session_id=sid, test_input_id=input_id) == ids[1]
    assert actions.current_request_id(actor=actor, session_id=sid, test_input_id="") is None
    with pytest.raises(ConflictError, match="test request is no longer current"):
        actions.execute(
            actor=actor,
            session_id=sid,
            test_input_id=input_id,
            command=NativeCommand("resume", ids[0], {"expected_generation": 0}),
            idempotency_key="stale-command",
        )


def test_old_request_cannot_control_current_test(action_case: ActionCase) -> None:
    from core.dify_builder.errors import ConflictError
    from core.dify_builder.models import Action

    svc, actor, sid, _, commands, _ = action_case
    version = svc.get_session_view(sid, actor).version
    with pytest.raises(ConflictError):
        svc.submit_action(
            sid,
            actor,
            Action(
                kind="cancel_test", payload={"request_id": "old"}, base_version=version, base_app_revision="revision"
            ),
        )
    assert commands.commands == []


def test_native_controls_keep_session_and_draft_version_guards(action_case: ActionCase) -> None:
    from core.dify_builder.errors import ConflictError
    from core.dify_builder.models import Action

    svc, actor, sid, _, commands, _ = action_case
    view = svc.get_session_view(sid, actor)
    for version, revision in [(view.version - 1, "revision"), (view.version, "stale")]:
        with pytest.raises(ConflictError):
            svc.submit_action(
                sid,
                actor,
                Action(
                    kind="cancel_test",
                    payload={"request_id": "request-1"},
                    base_version=version,
                    base_app_revision=revision,
                ),
            )
    assert commands.commands == []


def test_response_loss_retries_same_action_without_a_second_native_command(action_case: ActionCase) -> None:
    from core.dify_builder.models import Action

    svc, actor, sid, repo, commands, _ = action_case
    version = svc.get_session_view(sid, actor).version

    def submit() -> SessionView:
        return svc.submit_action(
            sid,
            actor,
            Action(
                kind="resume_test",
                payload={"request_id": "request-1", "expected_generation": 0},
                base_version=version,
                base_app_revision="revision",
            ),
        )

    first = submit()
    again = submit()
    assert first.version == again.version
    assert len(commands.commands) == 1
    assert len(repo.list_conversation(sid)) == 1


def test_readonly_session_sse_retains_receipt_and_explicit_action_payload(action_case: ActionCase) -> None:
    from services.dify_builder.wiring import session_view_to_dict

    svc, actor, sid, _, commands, _ = action_case
    data = DifyBuilderSessionViewResponse.model_validate(session_view_to_dict(svc.get_session_view(sid, actor)))
    assert data.test_execution is not None
    assert data.test_execution.request_id == "request-1"
    assert data.actions[0].payload == {"request_id": "request-1", "expected_generation": 0}
    assert commands.commands == []


def test_unknown_result_does_not_allow_run_test_or_implicit_replay(action_case: ActionCase) -> None:
    from core.dify_builder.errors import BusyError
    from core.dify_builder.models import Action

    svc, actor, sid, _, commands, _ = action_case
    commands.receipt = commands.receipt.model_copy(
        update={"status": "terminal", "outcome": "unknown", "can_resume": False}
    )
    view = svc.get_session_view(sid, actor)
    assert view.actions == []
    with pytest.raises(BusyError):
        svc.submit_action(sid, actor, Action(kind="run_test", base_version=view.version, base_app_revision="revision"))
    assert commands.commands == []


def test_waiting_operation_uses_existing_choice_with_concrete_risk_details(action_case: ActionCase) -> None:
    from datetime import UTC, datetime, timedelta

    from runtime_contracts.builder.native.approval_contracts import NativeApprovalTerms
    from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    svc, actor, sid, _, commands, _ = action_case
    pending = PendingActionDisclosure(
        pending_operation_id="p1",
        wait_reason="approval",
        version=4,
        scope_digest="a" * 64,
        account_label="Test account",
        action="mail.read",
        target={"message_id": "synthetic-1"},
        parameters_summary={"limit": 1},
        risk_notice="Reads one test message",
        required_configuration=(),
        native_form_ref=None,
        approval_limits=NativeApprovalTerms(
            max_calls=1,
            max_dispatches=1,
            max_cost_units=0,
            expires_at=(datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
        ),
        decision_status="awaiting_decision",
    )
    commands.receipt = commands.receipt.model_copy(update={"pending": (pending,), "can_resume": False})
    view = svc.get_session_view(sid, actor)
    assert view.run_status == "waiting_confirmation"
    assert view.decision is not None
    assert "synthetic-1" in english_text(view.decision.description)
    assert "Reads one test message" in english_text(view.decision.description)
    assert view.actions[0].payload == {
        "request_id": "request-1",
        "pending_operation_id": "p1",
        "pending_version": 4,
        "scope_digest": "a" * 64,
    }


def test_standard_choice_envelope_can_submit_native_control() -> None:
    from services.dify_builder.service import resolve_submitted_action
    from services.dify_builder.test_actions import parse_test_action

    payload = {"option_id": "resume_test", "request_id": "r1", "expected_generation": 2}
    command = parse_test_action(resolve_submitted_action("confirm", payload), payload)
    assert command.native_payload == {"expected_generation": 2}


def test_earlier_action_identity_cannot_be_reused_after_another_command(action_case: ActionCase) -> None:
    from core.dify_builder.errors import ConflictError
    from core.dify_builder.models import Action

    svc, actor, sid, _, commands, _ = action_case
    for identity in ["A", "B"]:
        version = svc.get_session_view(sid, actor).version
        svc.submit_action(
            sid,
            actor,
            Action(
                kind="resume_test",
                payload={"request_id": "request-1", "expected_generation": 0},
                base_version=version,
                base_app_revision="revision",
                command_id=identity,
            ),
        )
    with pytest.raises(ConflictError):
        svc.submit_action(
            sid,
            actor,
            Action(
                kind="cancel_test",
                payload={"request_id": "request-1"},
                base_version=svc.get_session_view(sid, actor).version,
                base_app_revision="revision",
                command_id="A",
            ),
        )
    assert len(commands.commands) == 2
