"""Durable material queue scope, dedupe and generation CAS over real SQL."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime
from typing import override

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker

from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Graph, Session
from core.dify_builder.state import PcState
from extensions.storage.storage_type import StorageType
from models.base import Base
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.dify_builder.attachment_extraction import ExtractedContext
from services.dify_builder.attachment_intake import MaterialReceipt, NativeContextUpload
from services.dify_builder.repository import SqlDifyBuilderRepository

type Queued = tuple[SqlDifyBuilderRepository, Session, DifyBuilderContext, str]
type Command = tuple[str, Action, Actor, str]

ACTOR = Actor(account_id="33333333-3333-3333-3333-333333333333", tenant_id="11111111-1111-1111-1111-111111111111")


@pytest.fixture
def queued() -> Iterator[Queued]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repo = SqlDifyBuilderRepository(sessionmaker(bind=engine))
    session = Session(
        app_id="22222222-2222-2222-2222-222222222222",
        tenant_id=ACTOR.tenant_id,
        owner_account_id=ACTOR.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    context = DifyBuilderContext(goal_text="Keep this goal")
    repo.create_session(session, context, [])
    with SqlSession(engine) as sql:
        upload = UploadFile(
            tenant_id=ACTOR.tenant_id,
            storage_type=StorageType.LOCAL,
            key="native-key",
            name="rules.txt",
            size=5,
            extension="txt",
            mime_type="text/plain",
            created_by=ACTOR.account_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_at=datetime.now(),
            used=False,
        )
        sql.add(upload)
        sql.commit()
        upload_id = upload.id
    yield repo, session, context, upload_id
    engine.dispose()


def queue(
    repo: SqlDifyBuilderRepository,
    session: Session,
    upload_id: str | None,
    *,
    turn: str = "turn",
    text: str = "",
    actor: Actor = ACTOR,
    generation: int = 0,
) -> MaterialReceipt:
    return repo.queue_builder_material(
        session.id,
        actor,
        expected_generation=generation,
        task_id=f"{session.id}:0",
        client_turn_id=turn,
        text=text,
        upload_file_ids=[upload_id] if upload_id else [],
    )


def test_authorized_upload_association_is_durable_and_idempotent(queued: Queued) -> None:
    repo, session, _, upload_id = queued
    first = queue(repo, session, upload_id)
    assert first.status == "pending"
    assert first.app_id == session.app_id
    assert first.uploads[0]["upload_file_id"] == upload_id
    assert queue(repo, session, upload_id).id == first.id
    with pytest.raises(ConflictError):
        queue(repo, session, upload_id, text="different")
    assert repo.get_session(session.id)[0].version == 1
    assert len(repo.list_builder_material(session.id, ACTOR)) == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [("tenant_id", "99999999-9999-9999-9999-999999999999"), ("account_id", "88888888-8888-8888-8888-888888888888")],
)
def test_foreign_actor_cannot_queue_or_observe_uploads(queued: Queued, field: str, value: str) -> None:
    repo, session, _, upload_id = queued
    with pytest.raises(NotFoundError):
        queue(repo, session, upload_id, actor=replace(ACTOR, **{field: value}))
    assert repo.list_builder_material(session.id, ACTOR) == []


def test_old_generation_cannot_queue_after_stop(queued: Queued) -> None:
    repo, session, context, upload_id = queued
    context.paused = True
    context.task_control = {"generation": 1}
    repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    with pytest.raises(ConflictError):
        queue(repo, session, upload_id)


def test_fixed_watermark_consumes_only_accepted_prefix_atomically(queued: Queued) -> None:
    from services.dify_builder.attachment_intake import MaterialResult

    repo, session, context, upload_id = queued
    first = queue(repo, session, upload_id)
    second = queue(repo, session, None, turn="later", text="Later supplement")
    result = MaterialResult(
        first.id,
        [{"upload_file_id": upload_id, "status": "consumed", "text": "Rules", "digest": "a" * 64, "reason": ""}],
    )
    new_version = repo.consume_builder_material(
        session.id,
        ACTOR,
        base_version=1,
        expected_generation=0,
        task_id=f"{session.id}:0",
        watermark=first.seq,
        results=[result],
        context=context,
        next_state=session.current_state,
    )
    assert new_version == 2
    receipts = repo.list_builder_material(session.id, ACTOR)
    assert [(row.id, row.status) for row in receipts] == [(first.id, "consumed"), (second.id, "pending")]
    assert receipts[0].consumed_version == 2
    with pytest.raises(ConflictError):
        repo.consume_builder_material(
            session.id,
            ACTOR,
            base_version=1,
            expected_generation=0,
            task_id=f"{session.id}:0",
            watermark=second.seq,
            results=[],
            context=context,
            next_state=session.current_state,
        )
    assert repo.list_builder_material(session.id, ACTOR)[1].status == "pending"


def test_runner_consumes_local_material_before_cognition_without_changing_trusted_goal(queued: Queued) -> None:
    from datetime import datetime

    from core.dify_builder.models import Action, Turn
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.application.runner import Env, Runner
    from services.dify_builder.attachment_extraction import extract_local_context
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, StubAgent

    repo, session, _, upload_id = queued
    queue(repo, session, upload_id)
    intake = BuilderAttachmentIntake(repo, lambda upload: extract_local_context(upload.extension, [b"Invoice rules"]))

    class Agent(StubAgent):
        @override
        def analyze_goal(self, goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
            del reply_language
            from services.dify_builder.attachment_context import append_material

            durable, context = repo.get_session(session.id)
            assert durable.version >= 2
            assert context.attachment_material[0]["text"] == "Invoice rules"
            assert goal_text == "Keep this goal"
            prompt = append_material("GOAL: " + goal_text)
            assert "UNTRUSTED ATTACHMENT MATERIAL" in prompt
            assert prompt.index("Keep this goal") < prompt.index("Invoice rules")
            return {"fields": [{"key": "question", "type": "text", "label": "Question"}], "values": {}}

    env = Env(dify=FakeDifyPort(), agent=Agent(), repo=repo, now=lambda: datetime.min, consume_material=intake.consume)
    Runner(env, build_registry()).advance(
        session.id, Turn(actor=ACTOR, action=Action(kind="start_build", base_version=1))
    )
    assert repo.list_builder_material(session.id, ACTOR)[0].status == "consumed"
    assert repo.get_session(session.id)[1].goal_text == "Keep this goal"


def test_stopped_extraction_cannot_commit_late_results(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake

    repo, session, context, upload_id = queued
    queue(repo, session, upload_id)

    def extract(_upload: NativeContextUpload) -> ExtractedContext:
        stopped = replace(context, paused=True, task_control={"generation": 1})
        repo.compare_and_advance(session.id, 1, session.current_state, stopped, [])
        return ExtractedContext("ready", "Late results", "a" * 64)

    intake = BuilderAttachmentIntake(repo, extract)
    with pytest.raises(ConflictError):
        intake.consume(session, context, ACTOR)
    _, persisted = repo.get_session(session.id)
    assert persisted.attachment_material == []
    assert repo.list_builder_material(session.id, ACTOR)[0].status == "superseded"


def test_working_message_queues_and_never_dispatches_or_changes_context(queued: Queued) -> None:
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, upload_id = queued
    lock = FakeSessionLock()
    lock.acquire(session.id)

    def unexpected_extraction(_upload: NativeContextUpload) -> ExtractedContext:
        raise AssertionError("working-message submission must not extract attachments")

    dispatched: list[Command] = []
    service = DifyBuilderService(
        repo,
        lock,
        lambda session_id, action, actor, token: dispatched.append((session_id, action, actor, token)),
        attachment_intake=BuilderAttachmentIntake(repo, unexpected_extraction),
    )
    view = service.submit_message(session.id, ACTOR, "More rules", 1, "queued-turn", attachments=[upload_id])
    assert view.attachments[0]["status"] == "pending"
    assert dispatched == []
    assert repo.get_session(session.id)[0].version == 1
    assert repo.get_session(session.id)[1].goal_text == "Keep this goal"


@pytest.mark.parametrize("owner_field", ["tenant_id", "created_by", "created_by_role"])
def test_native_upload_requires_current_tenant_account_and_account_role(queued: Queued, owner_field: str) -> None:
    repo, session, _, upload_id = queued
    with repo._session_factory.begin() as sql:
        row = sql.get(UploadFile, upload_id)
        setattr(
            row,
            owner_field,
            CreatorUserRole.END_USER if owner_field == "created_by_role" else "99999999-9999-9999-9999-999999999999",
        )
    with pytest.raises(NotFoundError, match="upload not found"):
        queue(repo, session, upload_id)
    assert repo.list_builder_material(session.id, ACTOR) == []


def test_test_stage_upload_is_only_a_candidate_and_does_not_bind_or_approve(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake

    repo, session, context, upload_id = queued
    session.current_state = PcState.BUILD_AWAIT_TESTDATA
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    receipt = queue(repo, session, upload_id)
    assert receipt.test_candidate
    updated, material, invalidated = BuilderAttachmentIntake(
        repo, lambda _upload: ExtractedContext("ready", "Test rows")
    ).consume(session, context, ACTOR)
    assert updated.current_state == PcState.BUILD_AWAIT_TESTDATA
    assert not invalidated
    assert material.test_input_ref == ""
    assert material.attachment_material == []


def test_consumption_persists_ordered_user_supplements_in_conversation(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake

    repo, session, context, _ = queued
    queue(repo, session, None, turn="first", text="First supplement")
    queue(repo, session, None, turn="second", text="Second supplement")
    BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("rejected")).consume(session, context, ACTOR)
    users = [item.payload for item in repo.list_conversation(session.id) if item.kind == "user"]
    assert [(item["turn_id"], item["text"]) for item in users] == [
        ("first", "First supplement"),
        ("second", "Second supplement"),
    ]


def test_queued_edit_material_reanalyzes_and_never_uses_old_plan_approval(queued: Queued) -> None:
    from datetime import datetime

    from core.dify_builder.models import Action, Turn
    from services.dify_builder.application.handlers_edit import edit_registry
    from services.dify_builder.application.runner import Env, Runner
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, StubAgent

    repo, session, context, upload_id = queued
    context.active_entry_mode = "edit"
    session.current_state = PcState.EDIT_PLAN_APPROVAL
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    queue(repo, session, upload_id)
    port = FakeDifyPort()
    analyzed = []

    class Agent(StubAgent):
        @override
        def analyze_impact(
            self, goal_text: str, graph: Graph, *, reply_language: str | None = None
        ) -> dict[str, object]:
            del graph, reply_language
            analyzed.append(goal_text)
            return {"fields": [{"key": "decision", "type": "text", "label": "Decision"}], "values": {}}

    intake = BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", "New policy"))
    env = Env(dify=port, agent=Agent(), repo=repo, now=lambda: datetime.min, consume_material=intake.consume)
    Runner(env, edit_registry()).advance(
        session.id, Turn(actor=ACTOR, action=Action(kind="approve_edit_plan", base_version=session.version))
    )
    assert analyzed == ["Keep this goal"]
    assert repo.get_session(session.id)[0].current_state == PcState.EDIT_IMPACT_ANALYSIS


@pytest.mark.parametrize("scenario", ["build", "edit", "fix"])
def test_create_persists_upload_association_before_initial_dispatch(queued: Queued, scenario: str) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, original, _, upload_id = queued
    dispatched: list[str] = []

    def enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
        del action, token
        receipt = repo.list_builder_material(session_id, actor)[0]
        assert receipt.app_id == original.app_id
        assert receipt.status == "pending"
        dispatched.append(session_id)

    service = DifyBuilderService(
        repo,
        FakeSessionLock(),
        enqueue,
        cognition_policy_fn=lambda _actor, _config: {},
        attachment_intake=BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", "Rules")),
    )
    if scenario == "build":
        view = service.create_build_session(original.app_id, ACTOR, "", attachments=[upload_id])
    elif scenario == "edit":
        view = service.create_edit_session(original.app_id, ACTOR, "", attachments=[upload_id])
    else:
        view = service.create_fix_session(original.app_id, ACTOR, failed_run_id="failed", attachments=[upload_id])
    assert dispatched == [view.session_id]
    assert view.attachments[0]["attachments"][0]["upload_file_id"] == upload_id


def test_consumed_receipt_reports_escaped_prompt_truncation(queued: Queued) -> None:
    import json

    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake

    repo, session, context, upload_id = queued
    queue(repo, session, upload_id)
    intake = BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", '"' * 20000))
    _, updated, _ = intake.consume(session, context, ACTOR)
    assert repo.list_builder_material(session.id, ACTOR)[0].uploads[0]["status"] == "truncated"
    assert len(json.dumps(updated.attachment_material, ensure_ascii=False)) < 40000


def test_conversation_reference_budget_and_missing_session_fence(queued: Queued) -> None:
    from core.dify_builder.errors import BadRequestError
    from models.dify_builder import DifyBuilderSession

    repo, session, _, upload_id = queued
    ids = [upload_id]
    with repo._session_factory.begin() as sql:
        for index in range(4):
            upload = UploadFile(
                tenant_id=ACTOR.tenant_id,
                storage_type=StorageType.LOCAL,
                key=f"rules-{index}",
                name="rules.txt",
                size=5,
                extension="txt",
                mime_type="text/plain",
                created_by=ACTOR.account_id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=datetime.now(),
                used=False,
            )
            sql.add(upload)
            sql.flush()
            ids.append(upload.id)
    for index in range(4):
        repo.queue_builder_material(
            session.id,
            ACTOR,
            expected_generation=0,
            task_id=f"{session.id}:0",
            client_turn_id=str(index),
            text="",
            upload_file_ids=ids,
        )
    with pytest.raises(BadRequestError, match="limit"):
        queue(repo, session, upload_id, turn="over-budget")
    with repo._session_factory.begin() as sql:
        sql.delete(sql.get(DifyBuilderSession, session.id))
    with pytest.raises(NotFoundError):
        repo.read_builder_upload(
            session.id,
            ACTOR,
            receipt_id="unused",
            upload_file_id=upload_id,
            expected_generation=0,
            task_id=f"{session.id}:0",
        )


def test_material_queued_during_handler_survives_its_checkpoint_update(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake

    repo, session, context, upload_id = queued
    queue(repo, session, upload_id)
    context.checkpoint_seq = 42
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", "Rules")).consume(session, context, ACTOR)
    assert repo.list_builder_material(session.id, ACTOR)[0].status == "consumed"


def test_old_turn_replay_after_task_replacement_cannot_reactivate_its_association(queued: Queued) -> None:
    repo, session, context, upload_id = queued
    queue(repo, session, upload_id)
    context.task_control = {"generation": 1}
    repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    replay = repo.queue_builder_material(
        session.id,
        ACTOR,
        expected_generation=1,
        task_id=f"{session.id}:1",
        client_turn_id="turn",
        text="",
        upload_file_ids=[upload_id],
    )
    assert replay.status == "superseded"


def test_test_stage_text_supplement_invalidates_old_approvals_but_upload_remains_candidate(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake

    repo, session, context, upload_id = queued
    context.test_input_ref = "old-input"
    context.effect_confirmation = {"effect": "old-approval"}
    session.current_state = PcState.BUILD_AWAIT_TESTDATA
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    queue(repo, session, upload_id, text="Change the output format")
    _, updated, invalidated = BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", "Rows")).consume(
        session, context, ACTOR
    )
    assert invalidated
    assert updated.test_input_ref == ""
    assert updated.effect_confirmation == {}
    assert [item["source"] for item in updated.attachment_material] == ["user_supplement"]


def test_message_replay_cannot_change_channels_or_input(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, upload_id = queued
    session.current_state = PcState.BUILD_GOAL_ANALYSIS
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    lock = FakeSessionLock()
    service = DifyBuilderService(
        repo,
        lock,
        lambda *_args: None,
        attachment_intake=BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", "Rules")),
    )
    service.submit_message(session.id, ACTOR, "Original", session.version, "shared-turn")
    with pytest.raises(ConflictError, match="different input"):
        service.submit_message(session.id, ACTOR, "Original", session.version, "shared-turn", attachments=[upload_id])


def test_consumed_material_retry_as_text_does_not_start_partial_chat(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, _ = queued
    queue(repo, session, None, text="Supplement")
    intake = BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("rejected"))
    updated_session, updated_context, _ = intake.consume(session, context, ACTOR)
    repo.compare_and_advance(session.id, updated_session.version, PcState.BUILD_GOAL_ANALYSIS, updated_context, [])
    dispatched: list[bool] = []
    service = DifyBuilderService(
        repo, FakeSessionLock(), lambda *_args: dispatched.append(True), attachment_intake=intake
    )
    service.submit_message(session.id, ACTOR, "Supplement", 1, "turn")
    assert dispatched == []


def test_stale_ordinary_message_does_not_reserve_an_unaccepted_input_digest(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, _ = queued
    repo.compare_and_advance(session.id, 1, PcState.BUILD_GOAL_ANALYSIS, context, [])
    intake = BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("rejected"))
    service = DifyBuilderService(repo, FakeSessionLock(), lambda *_args: None, attachment_intake=intake)
    with pytest.raises(ConflictError):
        service.submit_message(session.id, ACTOR, "Rejected old input", 1, "not-admitted")
    assert intake.find_turn(session, ACTOR, "not-admitted") is None


def test_lease_completion_during_intake_rechecks_head_and_schedules_pending_material(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, upload_id = queued
    lock = FakeSessionLock()
    token = lock.acquire(session.id)
    assert token is not None
    dispatched: list[Command] = []

    class CompletingRepository(SqlDifyBuilderRepository):
        @override
        def queue_builder_material(
            self,
            session_id: str,
            actor: Actor,
            *,
            expected_generation: int,
            task_id: str,
            client_turn_id: str,
            text: str,
            upload_file_ids: list[str],
            as_message: bool = False,
        ) -> MaterialReceipt:
            receipt = super().queue_builder_material(
                session_id,
                actor,
                expected_generation=expected_generation,
                task_id=task_id,
                client_turn_id=client_turn_id,
                text=text,
                upload_file_ids=upload_file_ids,
                as_message=as_message,
            )
            self.compare_and_advance(session.id, 1, PcState.BUILD_GOAL_ANALYSIS, context, [])
            lock.release(session.id, token)
            return receipt

    intake = BuilderAttachmentIntake(
        CompletingRepository(repo._session_factory), lambda _upload: ExtractedContext("ready", "Rules")
    )
    service = DifyBuilderService(
        repo,
        lock,
        lambda session_id, action, actor, token: dispatched.append((session_id, action, actor, token)),
        attachment_intake=intake,
    )
    service.submit_message(session.id, ACTOR, "", 1, "late", attachments=[upload_id])
    assert len(dispatched) == 1
    assert dispatched[0][1].kind == "consume_material"
    assert dispatched[0][1].base_version == 2


def test_post_release_pending_dispatch_reuses_existing_lease_and_dedupes_wakeups(queued: Queued) -> None:
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, upload_id = queued
    session.current_state = PcState.BUILD_GOAL_ANALYSIS
    repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    queue(repo, session, upload_id)
    lock = FakeSessionLock()
    dispatched: list[Command] = []
    service = DifyBuilderService(
        repo,
        lock,
        lambda session_id, action, actor, token: dispatched.append((session_id, action, actor, token)),
        attachment_intake=BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("ready", "Rules")),
    )
    assert service.dispatch_pending_material(session.id, ACTOR)
    assert service.dispatch_pending_material(session.id, ACTOR) == ""
    assert len(dispatched) == 1
    assert dispatched[0][1].base_version == 2


def test_ordinary_message_keeps_existing_two_commit_retry_and_hidden_chat_receipts(queued: Queued) -> None:
    from datetime import datetime

    from core.dify_builder.contract import UserItem
    from core.dify_builder.models import Turn
    from services.dify_builder.application.runner import Env, Runner
    from services.dify_builder.attachment_extraction import ExtractedContext
    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, StubAgent
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, _ = queued
    session.current_state = PcState.BUILD_GOAL_ANALYSIS
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    commands: list[Command] = []
    lock = FakeSessionLock()
    intake = BuilderAttachmentIntake(repo, lambda _upload: ExtractedContext("rejected"))
    service = DifyBuilderService(
        repo,
        lock,
        lambda session_id, action, actor, token: commands.append((session_id, action, actor, token)),
        attachment_intake=intake,
    )
    service.submit_message(session.id, ACTOR, "Question", session.version, "chat")
    pending = intake.find_turn(session, ACTOR, "chat")
    assert pending is not None
    assert pending.status == "chat_pending"
    item = UserItem(text="Question", turn_id="chat").to_item(seq=0, at_version=session.version + 1)
    context.next_seq = 1
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [item])
    env = Env(
        dify=FakeDifyPort(), agent=StubAgent(), repo=repo, now=lambda: datetime.min, consume_material=intake.consume
    )
    Runner(env, {}).advance(session.id, Turn(actor=ACTOR, action=commands[0][1]))
    consumed = intake.find_turn(session, ACTOR, "chat")
    assert consumed is not None
    assert consumed.status == "chat_consumed"
    assert repo.get_conversation_turn_kinds(session.id, "chat") == frozenset({"user", "assistant_turn"})
    assert repo.list_builder_material(session.id, ACTOR) == []
    assert len([item for item in repo.list_conversation(session.id) if item.kind == "user"]) == 1


def test_chat_receipt_completion_preserves_conversation_conflict_translation(queued: Queued) -> None:
    from core.dify_builder.models import ConversationItem

    repo, session, context, _ = queued
    first = ConversationItem(seq=0, kind="user", payload={"text": "old"})
    context.next_seq = 1
    version = repo.compare_and_advance(session.id, 1, session.current_state, context, [first])
    with pytest.raises(ConflictError):
        repo.compare_and_advance(
            session.id,
            version,
            session.current_state,
            context,
            [ConversationItem(seq=0, kind="assistant_turn", payload={"turn_id": "duplicate"})],
        )


def test_hidden_chat_replay_records_do_not_exhaust_material_capacity(queued: Queued) -> None:
    repo, session, _, upload_id = queued
    for index in range(101):
        repo.queue_builder_material(
            session.id,
            ACTOR,
            expected_generation=0,
            task_id=f"{session.id}:0",
            client_turn_id=f"chat-{index}",
            text="Question",
            upload_file_ids=[],
            as_message=True,
        )
    assert repo.list_builder_material(session.id, ACTOR) == []
    receipt = queue(repo, session, upload_id, turn="actual-material")
    assert receipt.status == "pending"
    assert len(repo.list_builder_material(session.id, ACTOR)) == 1


def test_working_supplement_stream_acknowledges_pending_receipt_without_dispatch(queued: Queued) -> None:
    import json

    from services.dify_builder.attachment_intake import BuilderAttachmentIntake
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    repo, session, context, upload_id = queued
    lock = FakeSessionLock()
    token = lock.acquire(session.id)
    assert token is not None
    owner = lock.activate(session.id, token)
    assert owner is not None
    dispatched: list[Command] = []

    def unexpected_extraction(_upload: NativeContextUpload) -> ExtractedContext:
        raise AssertionError("queued supplement acknowledgment must not extract attachments")

    service = DifyBuilderService(
        repo,
        lock,
        lambda session_id, action, actor, token: dispatched.append((session_id, action, actor, token)),
        attachment_intake=BuilderAttachmentIntake(repo, unexpected_extraction),
    )
    frames = list(service.submit_message_stream(session.id, ACTOR, "More rules", 1, "queued-stream", [upload_id]))
    events = [json.loads(frame.split("data: ", 1)[1]) for frame in frames]
    assert [event["event"] for event in events] == ["command_started", "command_finished"]
    started, finished = [event["data"] for event in events]
    assert started["command_id"] == finished["command_id"] == ""
    assert started["version"] == finished["version"] == 1
    assert started["run_status"] == finished["run_status"] == "processing"
    assert finished["session_id"] == session.id
    receipt = finished["attachments"][0]
    assert receipt["status"] == "pending"
    assert receipt["client_turn_id"] == "queued-stream"
    assert receipt["attachments"][0]["upload_file_id"] == upload_id
    persisted = repo.list_builder_material(session.id, ACTOR)
    assert len(persisted) == 1
    assert persisted[0].id == receipt["id"]
    assert persisted[0].text == "More rules"
    assert persisted[0].status == "pending"
    assert repo.get_session(session.id) == (session, context)
    assert dispatched == []
    assert lock.current_owner(session.id) == owner
