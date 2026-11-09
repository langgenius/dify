from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from graphon.runtime import VariablePool
from models.human_input import HumanInputDelivery, HumanInputForm, HumanInputFormRecipient
from services.human_input_form_delivery_provider import (
    HumanInputFormDeliveryContext,
    HumanInputFormDeliveryDispatcher,
    HumanInputFormDeliveryProviderRegistry,
)
from tasks import mail_human_input_delivery_task as task_module


@pytest.mark.parametrize(
    "sqlite_session", [(HumanInputForm, HumanInputDelivery, HumanInputFormRecipient)], indirect=True
)
@pytest.mark.parametrize(
    ("email_only", "mail_inited", "feature_enabled", "feature_error", "expected_methods"),
    [
        (True, True, True, False, (task_module.DeliveryMethodType.EMAIL,)),
        (True, True, False, False, ()),
        (True, False, True, False, ()),
        (False, True, True, False, task_module.FORM_DELIVERY_METHOD_TYPES),
        (False, False, True, False, (task_module.DeliveryMethodType.IM,)),
        (False, True, False, False, (task_module.DeliveryMethodType.IM,)),
        (False, True, True, True, (task_module.DeliveryMethodType.IM,)),
    ],
    ids=[
        "legacy-email",
        "legacy-disabled",
        "legacy-unconfigured",
        "all-channels",
        "im-without-mail",
        "im-without-feature",
        "im-after-feature-error",
    ],
)
def test_delivery_task_dispatches_available_persisted_channels(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
    email_only: bool,
    mail_inited: bool,
    feature_enabled: bool,
    feature_error: bool,
    expected_methods: tuple[task_module.DeliveryMethodType, ...],
) -> None:
    form = HumanInputForm(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_run_id=None,
        conversation_id=None,
        node_id="human-input",
        form_definition="{}",
        rendered_content="content",
        expiration_time=datetime.now(UTC) + timedelta(hours=1),
    )
    sqlite_session.add(form)
    sqlite_session.flush()
    deliveries = [
        HumanInputDelivery(form_id=form.id, delivery_method_type=method, channel_payload="{}")
        for method in task_module.FORM_DELIVERY_METHOD_TYPES
    ]
    sqlite_session.add_all(deliveries)
    sqlite_session.commit()
    pool = VariablePool()
    sent: list[HumanInputFormDeliveryContext] = []
    loading_sessions: list[Session] = []
    feature_tenants: list[str] = []
    load_contexts = HumanInputFormDeliveryDispatcher.load_form_contexts

    def load(
        dispatcher: HumanInputFormDeliveryDispatcher,
        *,
        session: Session,
        form: HumanInputForm,
        variable_pool: VariablePool | None = None,
        delivery_method_types: Sequence[task_module.DeliveryMethodType] | None = None,
    ) -> tuple[HumanInputFormDeliveryContext, ...]:
        loading_sessions.append(session)
        assert session.bind is sqlite_engine
        assert variable_pool is pool
        assert delivery_method_types == (
            (task_module.DeliveryMethodType.EMAIL,) if email_only else task_module.FORM_DELIVERY_METHOD_TYPES
        )
        return load_contexts(
            dispatcher,
            session=session,
            form=form,
            variable_pool=variable_pool,
            delivery_method_types=delivery_method_types,
        )

    def dispatch(
        _registry: HumanInputFormDeliveryProviderRegistry,
        *,
        context: HumanInputFormDeliveryContext,
        continue_on_error: bool = True,
    ) -> bool:
        assert len(loading_sessions) == 1
        assert not loading_sessions[0].in_transaction()
        assert not loading_sessions[0].identity_map
        assert continue_on_error
        assert context.variable_pool is pool
        sent.append(context)
        return True

    from services.entities.feature_entities import FeatureModel
    from services.feature_service import FeatureService

    def features(tenant_id: str, **_kwargs: object) -> FeatureModel:
        feature_tenants.append(tenant_id)
        if feature_error:
            raise RuntimeError("feature service unavailable")
        return FeatureModel(human_input_email_delivery_enabled=feature_enabled)

    monkeypatch.setattr(task_module.mail, "is_inited", lambda: mail_inited)
    monkeypatch.setattr(FeatureService, "get_features", features)
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _run_id: pool)
    monkeypatch.setattr(HumanInputFormDeliveryProviderRegistry, "dispatch", dispatch)
    monkeypatch.setattr(HumanInputFormDeliveryDispatcher, "load_form_contexts", load)
    task = (
        task_module.dispatch_human_input_email_task
        if email_only
        else task_module.dispatch_human_input_form_delivery_task
    )
    task(
        form_id=form.id, node_title="Approve", session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    )
    assert tuple(context.delivery_method_type for context in sent) == expected_methods
    assert len(loading_sessions) == (0 if email_only and (not mail_inited or not feature_enabled) else 1)
    assert feature_tenants == ([form.tenant_id] if mail_inited else [])
    for context in sent:
        assert context.form_id == form.id
        assert context.tenant_id == form.tenant_id
        assert context.app_id == form.app_id
        assert context.rendered_content == "content"
        assert context.delivery_id in {delivery.id for delivery in deliveries}
