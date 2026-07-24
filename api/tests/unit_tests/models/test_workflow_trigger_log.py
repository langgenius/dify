import types

import pytest

from models.engine import db
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel


@pytest.fixture
def fake_db_scalar(monkeypatch):
    """Provide a controllable fake for db.session.scalar (SQLAlchemy 2.0 style)."""
    calls = []

    def _install(side_effect):
        def _fake_scalar(statement):
            calls.append(statement)
            return side_effect(statement)

        # Patch the modern API used by the model implementation
        monkeypatch.setattr(db.session, "scalar", _fake_scalar)

        # Backward-compatibility: if the implementation still uses db.session.get,
        # make it delegate to the same side_effect so tests remain valid on older code.
        if hasattr(db.session, "get"):

            def _fake_get(*_args, **_kwargs):
                return side_effect(None)

            monkeypatch.setattr(db.session, "get", _fake_get)

        return calls

    return _install


def make_account(id_: str = "acc-1"):
    # Use a simple object to avoid constructing a full SQLAlchemy model instance
    # Python 3.12 forbids reassigning __class__ for SimpleNamespace; not needed here.
    obj = types.SimpleNamespace()
    obj.id = id_
    return obj


def make_end_user(id_: str = "user-1"):
    # Lightweight stand-in object; no need to spoof class identity.
    obj = types.SimpleNamespace()
    obj.id = id_
    return obj


def test_created_by_account_returns_account_when_role_account(fake_db_scalar):
    account = make_account("acc-1")

    # The implementation uses db.session.scalar(select(Account)...). We only need to
    # return the expected object when called; the exact SQL is irrelevant for this unit test.
    def side_effect(_statement):
        return account

    fake_db_scalar(side_effect)

    log = WorkflowNodeExecutionModel(
        tenant_id="t1",
        app_id="a1",
        workflow_id="w1",
        triggered_from="workflow-run",
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="n1",
        node_type="start",
        title="Start",
        inputs=None,
        process_data=None,
        outputs=None,
        status="succeeded",
        error=None,
        elapsed_time=0.0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT.value,
        created_by="acc-1",
    )

    assert log.created_by_account is account


def test_created_by_account_returns_none_when_role_not_account(fake_db_scalar):
    # Even if an Account with matching id exists, property should return None when role is END_USER
    account = make_account("acc-1")

    def side_effect(_statement):
        return account

    fake_db_scalar(side_effect)

    log = WorkflowNodeExecutionModel(
        tenant_id="t1",
        app_id="a1",
        workflow_id="w1",
        triggered_from="workflow-run",
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="n1",
        node_type="start",
        title="Start",
        inputs=None,
        process_data=None,
        outputs=None,
        status="succeeded",
        error=None,
        elapsed_time=0.0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.END_USER.value,
        created_by="acc-1",
    )

    assert log.created_by_account is None


def test_created_by_end_user_returns_end_user_when_role_end_user(fake_db_scalar):
    end_user = make_end_user("user-1")

    def side_effect(_statement):
        return end_user

    fake_db_scalar(side_effect)

    log = WorkflowNodeExecutionModel(
        tenant_id="t1",
        app_id="a1",
        workflow_id="w1",
        triggered_from="workflow-run",
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="n1",
        node_type="start",
        title="Start",
        inputs=None,
        process_data=None,
        outputs=None,
        status="succeeded",
        error=None,
        elapsed_time=0.0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.END_USER.value,
        created_by="user-1",
    )

    assert log.created_by_end_user is end_user


def test_created_by_end_user_returns_none_when_role_not_end_user(fake_db_scalar):
    end_user = make_end_user("user-1")

    def side_effect(_statement):
        return end_user

    fake_db_scalar(side_effect)

    log = WorkflowNodeExecutionModel(
        tenant_id="t1",
        app_id="a1",
        workflow_id="w1",
        triggered_from="workflow-run",
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id="n1",
        node_type="start",
        title="Start",
        inputs=None,
        process_data=None,
        outputs=None,
        status="succeeded",
        error=None,
        elapsed_time=0.0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT.value,
        created_by="user-1",
    )

    assert log.created_by_end_user is None
