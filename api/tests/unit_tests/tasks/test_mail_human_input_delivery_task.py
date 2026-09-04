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


class _DummySession:
    def __init__(self, form) -> None:
        self._form = form

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def get(self, _model, _form_id):
        return self._form


def _make_context(delivery_method_type: task_module.DeliveryMethodType) -> SimpleNamespace:
    return SimpleNamespace(delivery_method_type=delivery_method_type)


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
    dispatcher.load_form_contexts.return_value = ("context",)
    default_registry = MagicMock(return_value=registry)
    dispatcher_factory = MagicMock(return_value=dispatcher)

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: "pool")
    monkeypatch.setattr(task_module.HumanInputFormDeliveryProviderRegistry, "default", default_registry)
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", dispatcher_factory)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    default_registry.assert_called_once_with(mail_client=mail)
    dispatcher_factory.assert_called_once_with(registry=registry)
    dispatcher.load_form_contexts.assert_called_once()
    dispatch_kwargs = dispatcher.load_form_contexts.call_args.kwargs
    assert dispatch_kwargs["session"].bind is sqlite_engine
    assert dispatch_kwargs["form"].id == form.id
    assert dispatch_kwargs["variable_pool"] == "pool"
    assert dispatch_kwargs["delivery_method_types"] == (task_module.DeliveryMethodType.EMAIL,)
    dispatcher.dispatch_contexts.assert_called_once_with(("context",))


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
    dispatcher.load_form_contexts.return_value = ()
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", lambda _registry: dispatcher)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    dispatcher.load_form_contexts.assert_not_called()
    dispatcher.dispatch_contexts.assert_not_called()


def test_dispatch_human_input_email_task_skips_when_mail_not_inited(monkeypatch: pytest.MonkeyPatch) -> None:
    mail = _DummyMail()
    mail._inited = False
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)
    dispatcher = MagicMock()

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", lambda _registry: dispatcher)

    task_module.dispatch_human_input_email_task(form_id="form-1", node_title="Approve", session_factory=lambda: None)

    dispatcher.load_form_contexts.assert_not_called()
    dispatcher.dispatch_contexts.assert_not_called()


def test_dispatch_human_input_form_delivery_task_loads_external_delivery_contexts(monkeypatch: pytest.MonkeyPatch):
    mail = _DummyMail()
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)
    session = _DummySession(form)
    registry = object()
    dispatcher = MagicMock()
    email_context = _make_context(task_module.DeliveryMethodType.EMAIL)
    im_context = _make_context(task_module.DeliveryMethodType.IM)
    dispatcher.load_form_contexts.return_value = (email_context, im_context)
    default_registry = MagicMock(return_value=registry)
    dispatcher_factory = MagicMock(return_value=dispatcher)

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: "pool")
    monkeypatch.setattr(task_module.HumanInputFormDeliveryProviderRegistry, "default", default_registry)
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", dispatcher_factory)

    task_module.dispatch_human_input_form_delivery_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: session,
    )

    default_registry.assert_called_once_with(mail_client=mail)
    dispatcher_factory.assert_called_once_with(registry=registry)
    dispatch_kwargs = dispatcher.load_form_contexts.call_args.kwargs
    assert dispatch_kwargs["session"] is session
    assert dispatch_kwargs["form"] is form
    assert dispatch_kwargs["variable_pool"] == "pool"
    assert dispatch_kwargs["delivery_method_types"] == task_module.FORM_DELIVERY_METHOD_TYPES
    dispatcher.dispatch_contexts.assert_called_once_with((email_context, im_context))


def test_dispatch_human_input_form_delivery_task_keeps_im_when_mail_not_inited(monkeypatch: pytest.MonkeyPatch):
    mail = _DummyMail()
    mail._inited = False
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)
    dispatcher = MagicMock()
    email_context = _make_context(task_module.DeliveryMethodType.EMAIL)
    im_context = _make_context(task_module.DeliveryMethodType.IM)
    dispatcher.load_form_contexts.return_value = (email_context, im_context)

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: None)
    monkeypatch.setattr(
        task_module.HumanInputFormDeliveryProviderRegistry,
        "default",
        MagicMock(return_value=object()),
    )
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", MagicMock(return_value=dispatcher))

    task_module.dispatch_human_input_form_delivery_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(form),
    )

    dispatch_kwargs = dispatcher.load_form_contexts.call_args.kwargs
    assert dispatch_kwargs["delivery_method_types"] == task_module.FORM_DELIVERY_METHOD_TYPES
    dispatcher.dispatch_contexts.assert_called_once_with((im_context,))


def test_dispatch_human_input_form_delivery_task_keeps_im_when_email_feature_disabled(
    monkeypatch: pytest.MonkeyPatch,
):
    mail = _DummyMail()
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)
    dispatcher = MagicMock()
    email_context = _make_context(task_module.DeliveryMethodType.EMAIL)
    im_context = _make_context(task_module.DeliveryMethodType.IM)
    dispatcher.load_form_contexts.return_value = (email_context, im_context)

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=False),
    )
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: None)
    monkeypatch.setattr(
        task_module.HumanInputFormDeliveryProviderRegistry,
        "default",
        MagicMock(return_value=object()),
    )
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", MagicMock(return_value=dispatcher))

    task_module.dispatch_human_input_form_delivery_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(form),
    )

    dispatch_kwargs = dispatcher.load_form_contexts.call_args.kwargs
    assert dispatch_kwargs["delivery_method_types"] == task_module.FORM_DELIVERY_METHOD_TYPES
    dispatcher.dispatch_contexts.assert_called_once_with((im_context,))


def test_dispatch_human_input_form_delivery_task_keeps_im_when_email_feature_lookup_fails(
    monkeypatch: pytest.MonkeyPatch,
):
    mail = _DummyMail()
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)
    dispatcher = MagicMock()
    email_context = _make_context(task_module.DeliveryMethodType.EMAIL)
    im_context = _make_context(task_module.DeliveryMethodType.IM)
    dispatcher.load_form_contexts.return_value = (email_context, im_context)

    def raise_feature_error(_tenant_id, **_kwargs):
        raise RuntimeError("feature service unavailable")

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(task_module.FeatureService, "get_features", raise_feature_error)
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: None)
    monkeypatch.setattr(
        task_module.HumanInputFormDeliveryProviderRegistry,
        "default",
        MagicMock(return_value=object()),
    )
    monkeypatch.setattr(task_module, "HumanInputFormDeliveryDispatcher", MagicMock(return_value=dispatcher))

    task_module.dispatch_human_input_form_delivery_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(form),
    )

    dispatch_kwargs = dispatcher.load_form_contexts.call_args.kwargs
    assert dispatch_kwargs["delivery_method_types"] == task_module.FORM_DELIVERY_METHOD_TYPES
    dispatcher.dispatch_contexts.assert_called_once_with((im_context,))
