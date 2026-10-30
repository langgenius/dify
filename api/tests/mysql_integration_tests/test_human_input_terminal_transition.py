from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event, local
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import delete, event
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from models.human_input import HumanInputForm
from services.errors.human_input import FormAlreadyHandledError

_Action = Literal["submit", "timeout"]


class _WorkerState(local):
    def __init__(self) -> None:
        self.role: str | None = None


@pytest.mark.parametrize(
    ("first_action", "second_action", "winning_status"),
    [
        ("submit", "timeout", HumanInputFormStatus.SUBMITTED),
        ("timeout", "submit", HumanInputFormStatus.TIMEOUT),
    ],
)
def test_submit_and_timeout_serialize_on_the_form_row(
    mysql_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    first_action: _Action,
    second_action: _Action,
    winning_status: HumanInputFormStatus,
) -> None:
    engine = mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ")
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "_session_maker", sessions)
    form_id = str(uuid4())
    definition = FormDefinition(
        form_content="Choose",
        rendered_content="Choose",
        expiration_time=datetime.now() + timedelta(hours=1),
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    with sessions.begin() as session:
        session.add(
            HumanInputForm(
                id=form_id,
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_run_id=str(uuid4()),
                form_kind=HumanInputFormKind.RUNTIME,
                node_id="human-input",
                form_definition=definition.model_dump_json(),
                rendered_content="Choose",
                expiration_time=definition.expiration_time,
                status=HumanInputFormStatus.WAITING,
            )
        )

    repository = HumanInputFormSubmissionRepository()
    first_locked = Event()
    second_attempted = Event()
    release_first = Event()
    worker = _WorkerState()

    def is_form_lock(statement: str) -> bool:
        normalized = " ".join(statement.lower().replace("`", "").split())
        return " from human_input_forms " in normalized and " for update" in normalized

    def observe_second(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if worker.role == "second" and is_form_lock(statement):
            second_attempted.set()

    def hold_first(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if worker.role == "first" and is_form_lock(statement):
            first_locked.set()
            assert release_first.wait(timeout=10)

    def transition(role: str, action: _Action) -> HumanInputFormStatus:
        worker.role = role
        if action == "submit":
            return repository.mark_submitted(
                form_id=form_id,
                recipient_id=None,
                selected_action_id="approve",
                form_data={"decision": "approve"},
                submission_user_id=None,
                submission_end_user_id=None,
            ).status
        return repository.mark_timeout(
            form_id=form_id,
            timeout_status=HumanInputFormStatus.TIMEOUT,
            reason="node_timeout",
        ).status

    event.listen(engine, "before_cursor_execute", observe_second)
    event.listen(engine, "after_cursor_execute", hold_first)
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        first = executor.submit(transition, "first", first_action)
        assert first_locked.wait(timeout=10)
        second = executor.submit(transition, "second", second_action)
        assert second_attempted.wait(timeout=10)
        assert not second.done()
        release_first.set()
        assert first.result(timeout=10) == winning_status
        with pytest.raises(FormAlreadyHandledError) as error:
            second.result(timeout=10)
        assert error.value.status == winning_status

        with sessions() as verifier:
            persisted = verifier.get(HumanInputForm, form_id)
            assert persisted is not None
            assert persisted.status == winning_status
    finally:
        release_first.set()
        executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_second)
        event.remove(engine, "after_cursor_execute", hold_first)
        with sessions.begin() as session:
            session.execute(delete(HumanInputForm).where(HumanInputForm.id == form_id))
