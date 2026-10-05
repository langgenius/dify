"""Unit tests for the ``resume_agent_app_execution`` Celery task (ENG-635)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource, EndUserType
from models.enums import InvokeFrom as StoredInvokeFrom
from models.human_input import HumanInputForm
from models.model import App, AppMode, Conversation, EndUser
from tasks.app_generate import resume_agent_app_task as mod
from tests.unit_tests.model_factories import make_app, make_conversation

MODULE = "tasks.app_generate.resume_agent_app_task"


@pytest.fixture
def task_session(mocker: MockerFixture, sqlite_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    """Bind the task's Flask-SQLAlchemy session proxy to the shared SQLite database."""
    registry = scoped_session(sqlite_session_factory)
    mocker.patch.object(mod.db, "session", registry)
    session = registry()
    yield session
    registry.remove()


def _app(*, app_id: str, tenant_id: str) -> App:
    return make_app(
        app_id=app_id,
        tenant_id=tenant_id,
        name="Agent app",
        mode=AppMode.AGENT_CHAT,
        icon_type=None,
        enable_site=False,
        enable_api=False,
    )


def _conversation(
    *,
    conversation_id: str,
    app_id: str,
    account_id: str | None = None,
    end_user_id: str | None = None,
    invoke_from: StoredInvokeFrom = StoredInvokeFrom.WEB_APP,
) -> Conversation:
    return make_conversation(
        conversation_id=conversation_id,
        app_id=app_id,
        mode=AppMode.AGENT_CHAT,
        name="Agent conversation",
        inputs={},
        invoke_from=invoke_from,
        from_source=ConversationFromSource.API,
        from_account_id=account_id,
        from_end_user_id=end_user_id,
    )


def _form(*, form_id: str, conversation_id: str, app_id: str) -> HumanInputForm:
    return HumanInputForm(
        id=form_id,
        tenant_id=str(uuid4()),
        app_id=app_id,
        workflow_run_id=None,
        conversation_id=conversation_id,
        form_kind=HumanInputFormKind.RUNTIME,
        node_id="ask-human",
        form_definition="{}",
        rendered_content="Question",
        status=HumanInputFormStatus.WAITING,
        expiration_time=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
    )


def _seed_account(session: Session, *, tenant_id: str, account_id: str) -> Account:
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    account = Account(name="Account", email="account@example.com")
    account.id = account_id
    join = TenantAccountJoin(
        tenant_id=tenant_id,
        account_id=account_id,
        current=True,
        role=TenantAccountRole.NORMAL,
    )
    session.add_all([tenant, account, join])
    return account


def test_resume_happy_path_account_user_sets_tenant_and_runs(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id, account_id = (str(uuid4()) for _ in range(5))
    app = _app(app_id=app_id, tenant_id=tenant_id)
    account = _seed_account(task_session, tenant_id=tenant_id, account_id=account_id)
    conversation = _conversation(conversation_id=conversation_id, app_id=app_id, account_id=account_id)
    task_session.add_all([app, conversation, _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id)])
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)

    call = generator.return_value.resume_after_form_submission.call_args
    assert call is not None
    assert call.kwargs["conversation_id"] == conversation_id
    assert call.kwargs["form_id"] == form_id
    assert call.kwargs["user"] is account
    assert call.kwargs["app_model"] is app
    assert call.kwargs["invoke_from"] == InvokeFrom.WEB_APP
    assert isinstance(call.kwargs["session"], Session)
    assert account.current_tenant_id == tenant_id


def test_resume_end_user_path(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id, end_user_id = (str(uuid4()) for _ in range(5))
    app = _app(app_id=app_id, tenant_id=tenant_id)
    end_user = EndUser(
        id=end_user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=EndUserType.BROWSER,
        name="End user",
        session_id="browser-session",
    )
    task_session.add_all(
        [
            app,
            end_user,
            _conversation(conversation_id=conversation_id, app_id=app_id, end_user_id=end_user_id),
            _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id),
        ]
    )
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)

    assert generator.return_value.resume_after_form_submission.call_args.kwargs["user"] is end_user


def test_resume_preserves_debugger_invoke_from(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id, account_id = (str(uuid4()) for _ in range(5))
    app = _app(app_id=app_id, tenant_id=tenant_id)
    _seed_account(task_session, tenant_id=tenant_id, account_id=account_id)
    task_session.add_all(
        [
            app,
            _conversation(
                conversation_id=conversation_id,
                app_id=app_id,
                account_id=account_id,
                invoke_from=StoredInvokeFrom.DEBUGGER,
            ),
            _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id),
        ]
    )
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)

    assert generator.return_value.resume_after_form_submission.call_args.kwargs["invoke_from"] == InvokeFrom.DEBUGGER


@pytest.mark.usefixtures("task_session")
def test_resume_returns_when_form_missing(mocker: MockerFixture) -> None:
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    mod.resume_agent_app_execution(conversation_id=str(uuid4()), form_id=str(uuid4()))
    generator.assert_not_called()


def test_resume_returns_on_conversation_mismatch(mocker: MockerFixture, task_session: Session) -> None:
    app_id, form_id = str(uuid4()), str(uuid4())
    task_session.add(_form(form_id=form_id, conversation_id=str(uuid4()), app_id=app_id))
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    mod.resume_agent_app_execution(conversation_id=str(uuid4()), form_id=form_id)
    generator.assert_not_called()


def test_resume_returns_when_app_missing(mocker: MockerFixture, task_session: Session) -> None:
    conversation_id, form_id = str(uuid4()), str(uuid4())
    task_session.add(_form(form_id=form_id, conversation_id=conversation_id, app_id=str(uuid4())))
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)
    generator.assert_not_called()


def test_resume_returns_when_conversation_missing(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id = (str(uuid4()) for _ in range(4))
    task_session.add_all(
        [
            _app(app_id=app_id, tenant_id=tenant_id),
            _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id),
        ]
    )
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)
    generator.assert_not_called()


def test_resume_returns_when_no_user_resolvable(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id = (str(uuid4()) for _ in range(4))
    task_session.add_all(
        [
            _app(app_id=app_id, tenant_id=tenant_id),
            _conversation(conversation_id=conversation_id, app_id=app_id),
            _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id),
        ]
    )
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)
    generator.assert_not_called()


def test_resume_returns_when_account_id_set_but_account_gone(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id = (str(uuid4()) for _ in range(4))
    task_session.add_all(
        [
            _app(app_id=app_id, tenant_id=tenant_id),
            _conversation(conversation_id=conversation_id, app_id=app_id, account_id=str(uuid4())),
            _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id),
        ]
    )
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)
    generator.assert_not_called()


def test_resume_swallows_generator_exception(mocker: MockerFixture, task_session: Session) -> None:
    tenant_id, app_id, conversation_id, form_id, account_id = (str(uuid4()) for _ in range(5))
    _seed_account(task_session, tenant_id=tenant_id, account_id=account_id)
    task_session.add_all(
        [
            _app(app_id=app_id, tenant_id=tenant_id),
            _conversation(conversation_id=conversation_id, app_id=app_id, account_id=account_id),
            _form(form_id=form_id, conversation_id=conversation_id, app_id=app_id),
        ]
    )
    task_session.commit()
    generator = mocker.patch(f"{MODULE}.AgentAppGenerator")
    generator.return_value.resume_after_form_submission.side_effect = RuntimeError("boom")

    mod.resume_agent_app_execution(conversation_id=conversation_id, form_id=form_id)

    generator.return_value.resume_after_form_submission.assert_called_once()
