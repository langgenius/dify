from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.human_input import HumanInputForm
from tasks import mail_human_input_delivery_task as task_module


class _DummyMail:
    def __init__(self) -> None:
        self._inited = True

    def is_inited(self) -> bool:
        return self._inited


def _form(*, workflow_run_id: str | None = None) -> HumanInputForm:
    return HumanInputForm(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_run_id=workflow_run_id,
        conversation_id=None,
        node_id="human-input",
        form_definition="{}",
        rendered_content="content",
        expiration_time=datetime.now(UTC) + timedelta(hours=1),
    )


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_dispatch_human_input_email_task_dispatches_form_deliveries(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    mail = _DummyMail()
    form = _form()
    sqlite_session.add(form)
    sqlite_session.commit()
    registry = object()
    dispatcher = MagicMock()

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: "pool")
    monkeypatch.setattr(task_module.HumanInputFormDeliveryProviderRegistry, "default", lambda **_kwargs: registry)
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", lambda registry: dispatcher)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    dispatcher.dispatch_form.assert_called_once()
    dispatch_kwargs = dispatcher.dispatch_form.call_args.kwargs
    assert dispatch_kwargs["form"] is form
    assert dispatch_kwargs["variable_pool"] == "pool"
    assert dispatch_kwargs["delivery_method_types"] == (task_module.DeliveryMethodType.EMAIL,)


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_dispatch_human_input_email_task_skips_when_feature_disabled(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    mail = _DummyMail()
    form = _form()
    sqlite_session.add(form)
    sqlite_session.commit()

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=False),
    )
    dispatcher = MagicMock()
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", lambda registry: dispatcher)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    dispatcher.dispatch_form.assert_not_called()


def test_dispatch_human_input_email_task_skips_when_mail_not_inited(monkeypatch: pytest.MonkeyPatch) -> None:
    mail = _DummyMail()
    mail._inited = False
    dispatcher = MagicMock()

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", lambda registry: dispatcher)

    task_module.dispatch_human_input_email_task(form_id="form-1", node_title="Approve", session_factory=lambda: None)

    dispatcher.dispatch_form.assert_not_called()
