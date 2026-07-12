"""Unit tests for the ``resume_agent_app_execution`` celery task (ENG-635).

Every DB access (``db.session.get``) and the generator are patched at the module
level, so the task's branch logic is exercised without a database or live stack.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from models.human_input import HumanInputForm
from models.model import App, Conversation, EndUser
from tasks.app_generate import resume_agent_app_task as mod

MODULE = "tasks.app_generate.resume_agent_app_task"


def _form(conversation_id: str = "conv-1", app_id: str = "app-1") -> MagicMock:
    return MagicMock(conversation_id=conversation_id, app_id=app_id)


def _wire_db(
    mocker: MockerFixture,
    *,
    form=None,
    app=None,
    conversation=None,
    account=None,
    end_user=None,
) -> MagicMock:
    """Patch the module ``db`` so ``db.session.get(Model, id)`` dispatches by model."""
    table = {
        HumanInputForm: form,
        App: app,
        Conversation: conversation,
        Account: account,
        EndUser: end_user,
    }
    db = mocker.patch(f"{MODULE}.db")
    db.session.get.side_effect = lambda model, _id: table.get(model)
    return db


def test_resume_happy_path_account_user_sets_tenant_and_runs(mocker: MockerFixture):
    conversation = MagicMock(from_account_id="acct-1", from_end_user_id=None, invoke_from=InvokeFrom.WEB_APP)
    account = MagicMock()
    app = MagicMock(tenant_id="tenant-1")
    _wire_db(mocker, form=_form(), app=app, conversation=conversation, account=account)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    account.set_tenant_id.assert_called_once_with("tenant-1")
    gen.return_value.resume_after_form_submission.assert_called_once()
    kwargs = gen.return_value.resume_after_form_submission.call_args.kwargs
    assert kwargs["conversation_id"] == "conv-1"
    assert kwargs["user"] is account
    assert kwargs["app_model"] is app
    assert kwargs["invoke_from"] == InvokeFrom.WEB_APP


def test_resume_end_user_path(mocker: MockerFixture):
    conversation = MagicMock(from_account_id=None, from_end_user_id="eu-1", invoke_from=InvokeFrom.WEB_APP)
    end_user = MagicMock()
    _wire_db(mocker, form=_form(), app=MagicMock(tenant_id="t"), conversation=conversation, end_user=end_user)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    assert gen.return_value.resume_after_form_submission.call_args.kwargs["user"] is end_user


def test_resume_preserves_debugger_invoke_from(mocker: MockerFixture):
    conversation = MagicMock(from_account_id="acct-1", from_end_user_id=None, invoke_from=InvokeFrom.DEBUGGER)
    account = MagicMock()
    app = MagicMock(tenant_id="tenant-1")
    _wire_db(mocker, form=_form(), app=app, conversation=conversation, account=account)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    assert gen.return_value.resume_after_form_submission.call_args.kwargs["invoke_from"] == InvokeFrom.DEBUGGER


def test_resume_returns_when_form_missing(mocker: MockerFixture):
    _wire_db(mocker, form=None)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    gen.assert_not_called()


def test_resume_returns_on_conversation_mismatch(mocker: MockerFixture):
    _wire_db(mocker, form=_form(conversation_id="other-conv"))
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    gen.assert_not_called()


def test_resume_returns_when_app_missing(mocker: MockerFixture):
    _wire_db(mocker, form=_form(), app=None)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    gen.assert_not_called()


def test_resume_returns_when_conversation_missing(mocker: MockerFixture):
    _wire_db(mocker, form=_form(), app=MagicMock(), conversation=None)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    gen.assert_not_called()


def test_resume_returns_when_no_user_resolvable(mocker: MockerFixture):
    conversation = MagicMock(from_account_id=None, from_end_user_id=None, invoke_from=InvokeFrom.WEB_APP)
    _wire_db(mocker, form=_form(), app=MagicMock(), conversation=conversation)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    gen.assert_not_called()


def test_resume_returns_when_account_id_set_but_account_gone(mocker: MockerFixture):
    conversation = MagicMock(from_account_id="acct-x", from_end_user_id=None, invoke_from=InvokeFrom.WEB_APP)
    _wire_db(mocker, form=_form(), app=MagicMock(), conversation=conversation, account=None)
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")

    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")

    gen.assert_not_called()


def test_resume_swallows_generator_exception(mocker: MockerFixture):
    conversation = MagicMock(from_account_id="acct-1", from_end_user_id=None, invoke_from=InvokeFrom.WEB_APP)
    _wire_db(mocker, form=_form(), app=MagicMock(tenant_id="t"), conversation=conversation, account=MagicMock())
    gen = mocker.patch(f"{MODULE}.AgentAppGenerator")
    gen.return_value.resume_after_form_submission.side_effect = RuntimeError("boom")

    # The task must not propagate the failure (it is logged and the session closed).
    mod.resume_agent_app_execution(conversation_id="conv-1", form_id="form-1")
