from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from configs import dify_config
from core.workflow.human_input_adapter import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
)
from graphon.runtime import VariablePool
from models.account import Account, TenantAccountJoin
from services import human_input_delivery_test_service as service_module
from services.human_input_delivery_test_service import (
    DeliveryTestContext,
    DeliveryTestEmailRecipient,
    DeliveryTestError,
    DeliveryTestRegistry,
    DeliveryTestResult,
    DeliveryTestStatus,
    DeliveryTestUnsupportedError,
    EmailDeliveryTestHandler,
    HumanInputDeliveryTestService,
    _build_form_link,
)


def _make_valid_email_config():
    return EmailDeliveryConfig(
        recipients=EmailRecipients(include_bound_group=False, items=[]),
        subject="Subj",
        body="Body",
    )


def test_build_form_link():
    with patch.object(dify_config, "APP_WEB_URL", "http://example.com/"):
        assert _build_form_link("token123") == "http://example.com/form/token123"

    with patch.object(dify_config, "APP_WEB_URL", "http://example.com"):
        assert _build_form_link("token123") == "http://example.com/form/token123"

    assert _build_form_link(None) is None

    with patch.object(dify_config, "APP_WEB_URL", None):
        assert _build_form_link("token123") is None


class TestDeliveryTestRegistry:
    def test_register(self):
        registry = DeliveryTestRegistry()
        assert len(registry._handlers) == 0
        handler = MagicMock()
        registry.register(handler)
        assert len(registry._handlers) == 1
        assert registry._handlers[0] == handler

    def test_register_and_dispatch(self):
        handler = MagicMock()
        handler.supports.return_value = True
        handler.send_test.return_value = DeliveryTestResult(status=DeliveryTestStatus.OK)

        registry = DeliveryTestRegistry([handler])
        context = MagicMock(spec=DeliveryTestContext)
        method = MagicMock()

        result = registry.dispatch(context=context, method=method)

        assert result.status == DeliveryTestStatus.OK
        handler.supports.assert_called_once_with(method)
        handler.send_test.assert_called_once_with(context=context, method=method)

    def test_dispatch_unsupported(self):
        handler = MagicMock()
        handler.supports.return_value = False

        registry = DeliveryTestRegistry([handler])
        context = MagicMock(spec=DeliveryTestContext)
        method = MagicMock()

        with pytest.raises(DeliveryTestUnsupportedError, match="Delivery method does not support test send."):
            registry.dispatch(context=context, method=method)

    def test_default(self, flask_app_with_containers, db_session_with_containers: Session):
        registry = DeliveryTestRegistry.default()
        assert len(registry._handlers) == 1
        assert isinstance(registry._handlers[0], EmailDeliveryTestHandler)


def test_human_input_delivery_test_service():
    registry = MagicMock(spec=DeliveryTestRegistry)
    service = HumanInputDeliveryTestService(registry=registry)
    context = MagicMock(spec=DeliveryTestContext)
    method = MagicMock()

    service.send_test(context=context, method=method)
    registry.dispatch.assert_called_once_with(context=context, method=method)


class TestEmailDeliveryTestHandler:
    def test_init_with_engine(self):
        engine = MagicMock(spec=Engine)
        handler = EmailDeliveryTestHandler(session_factory=engine)
        assert handler._session_factory.kw["bind"] == engine

    def test_supports(self):
        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        method = EmailDeliveryMethod(config=_make_valid_email_config())
        assert handler.supports(method) is True
        assert handler.supports(MagicMock()) is False

    def test_send_test_unsupported_method(self):
        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        with pytest.raises(DeliveryTestUnsupportedError):
            handler.send_test(context=MagicMock(), method=MagicMock())

    def test_send_test_feature_disabled(self, monkeypatch):
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_features",
            lambda _tenant_id: SimpleNamespace(human_input_email_delivery_enabled=False),
        )
        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        context = DeliveryTestContext(
            tenant_id="t1", app_id="a1", node_id="n1", node_title="title", rendered_content="content"
        )
        method = EmailDeliveryMethod(config=_make_valid_email_config())

        with pytest.raises(DeliveryTestError, match="Email delivery is not available"):
            handler.send_test(context=context, method=method)

    def test_send_test_mail_not_inited(self, monkeypatch):
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_features",
            lambda _id: SimpleNamespace(human_input_email_delivery_enabled=True),
        )
        monkeypatch.setattr(service_module.mail, "is_inited", lambda: False)

        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        context = DeliveryTestContext(
            tenant_id="t1", app_id="a1", node_id="n1", node_title="title", rendered_content="content"
        )
        method = EmailDeliveryMethod(config=_make_valid_email_config())

        with pytest.raises(DeliveryTestError, match="Mail client is not initialized."):
            handler.send_test(context=context, method=method)

    def test_send_test_no_recipients(self, monkeypatch):
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_features",
            lambda _id: SimpleNamespace(human_input_email_delivery_enabled=True),
        )
        monkeypatch.setattr(service_module.mail, "is_inited", lambda: True)

        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        handler._resolve_recipients = MagicMock(return_value=[])

        context = DeliveryTestContext(
            tenant_id="t1", app_id="a1", node_id="n1", node_title="title", rendered_content="content"
        )
        method = EmailDeliveryMethod(config=_make_valid_email_config())

        with pytest.raises(DeliveryTestError, match="No recipients configured"):
            handler.send_test(context=context, method=method)

    def test_send_test_success(self, monkeypatch):
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_features",
            lambda _id: SimpleNamespace(human_input_email_delivery_enabled=True),
        )
        monkeypatch.setattr(service_module.mail, "is_inited", lambda: True)
        mock_mail_send = MagicMock()
        monkeypatch.setattr(service_module.mail, "send", mock_mail_send)
        monkeypatch.setattr(service_module, "render_email_template", lambda t, s: f"RENDERED_{t}")

        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        handler._resolve_recipients = MagicMock(return_value=["test@example.com"])

        variable_pool = VariablePool()
        context = DeliveryTestContext(
            tenant_id="t1",
            app_id="a1",
            node_id="n1",
            node_title="title",
            rendered_content="content",
            variable_pool=variable_pool,
            recipients=[DeliveryTestEmailRecipient(email="test@example.com", form_token="token123")],
        )

        method = EmailDeliveryMethod(config=_make_valid_email_config())

        result = handler.send_test(context=context, method=method)

        assert result.status == DeliveryTestStatus.OK
        assert result.delivered_to == ["test@example.com"]
        mock_mail_send.assert_called_once()
        args, kwargs = mock_mail_send.call_args
        assert kwargs["to"] == "test@example.com"
        assert "RENDERED_Subj" in kwargs["subject"]

    def test_send_test_sanitizes_subject(self, monkeypatch):
        monkeypatch.setattr(
            service_module.FeatureService,
            "get_features",
            lambda _id: SimpleNamespace(human_input_email_delivery_enabled=True),
        )
        monkeypatch.setattr(service_module.mail, "is_inited", lambda: True)
        mock_mail_send = MagicMock()
        monkeypatch.setattr(service_module.mail, "send", mock_mail_send)
        monkeypatch.setattr(
            service_module,
            "render_email_template",
            lambda template, substitutions: template.replace("{{ recipient_email }}", substitutions["recipient_email"]),
        )

        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        handler._resolve_recipients = MagicMock(return_value=["test@example.com"])

        context = DeliveryTestContext(
            tenant_id="t1",
            app_id="a1",
            node_id="n1",
            node_title="title",
            rendered_content="content",
            recipients=[DeliveryTestEmailRecipient(email="test@example.com", form_token="token123")],
        )
        method = EmailDeliveryMethod(
            config=EmailDeliveryConfig(
                recipients=EmailRecipients(whole_workspace=False, items=[]),
                subject="<b>Notice</b>\r\nBCC:{{ recipient_email }}",
                body="Body",
            )
        )

        handler.send_test(context=context, method=method)

        _, kwargs = mock_mail_send.call_args
        assert kwargs["subject"] == "Notice BCC:test@example.com"

    def test_resolve_recipients_external(self):
        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        method = EmailDeliveryMethod(
            config=EmailDeliveryConfig(
                recipients=EmailRecipients(
                    items=[ExternalRecipient(email="ext@example.com")], include_bound_group=False
                ),
                subject="",
                body="",
            )
        )
        assert handler._resolve_recipients(tenant_id="t1", method=method) == ["ext@example.com"]

    def test_resolve_recipients_member(self, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        account = Account(name="Test User", email="member@example.com")
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        join = TenantAccountJoin(tenant_id=tenant_id, account_id=account.id)
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        from extensions.ext_database import db

        handler = EmailDeliveryTestHandler(session_factory=db.engine)
        method = EmailDeliveryMethod(
            config=EmailDeliveryConfig(
                recipients=EmailRecipients(items=[MemberRecipient(reference_id=account.id)], include_bound_group=False),
                subject="",
                body="",
            )
        )
        assert handler._resolve_recipients(tenant_id=tenant_id, method=method) == ["member@example.com"]

    def test_resolve_recipients_whole_workspace(self, flask_app_with_containers, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        account1 = Account(name="User 1", email=f"u1-{uuid4()}@example.com")
        account2 = Account(name="User 2", email=f"u2-{uuid4()}@example.com")
        db_session_with_containers.add_all([account1, account2])
        db_session_with_containers.commit()

        for acc in [account1, account2]:
            join = TenantAccountJoin(tenant_id=tenant_id, account_id=acc.id)
            db_session_with_containers.add(join)
        db_session_with_containers.commit()

        from extensions.ext_database import db

        handler = EmailDeliveryTestHandler(session_factory=db.engine)
        method = EmailDeliveryMethod(
            config=EmailDeliveryConfig(
                recipients=EmailRecipients(items=[], include_bound_group=True),
                subject="",
                body="",
            )
        )
        recipients = handler._resolve_recipients(tenant_id=tenant_id, method=method)
        assert set(recipients) == {account1.email, account2.email}

    def test_query_workspace_member_emails_empty_ids(self):
        handler = EmailDeliveryTestHandler(session_factory=MagicMock())
        assert handler._query_workspace_member_emails(tenant_id="t1", user_ids=[]) == {}

    def test_build_substitutions(self):
        context = DeliveryTestContext(
            tenant_id="t1",
            app_id="a1",
            node_id="n1",
            node_title="title",
            rendered_content="content",
            template_vars={"custom": "var"},
            recipients=[DeliveryTestEmailRecipient(email="test@example.com", form_token="token123")],
        )

        with patch.object(dify_config, "APP_WEB_URL", "http://example.com"):
            subs = EmailDeliveryTestHandler._build_substitutions(context=context, recipient_email="test@example.com")

        assert subs["node_title"] == "title"
        assert subs["form_content"] == "content"
        assert subs["recipient_email"] == "test@example.com"
        assert subs["custom"] == "var"
        assert subs["form_token"] == "token123"
        assert "form/token123" in subs["form_link"]

        subs_no_match = EmailDeliveryTestHandler._build_substitutions(
            context=context, recipient_email="other@example.com"
        )
        assert subs_no_match["form_token"] == ""
        assert subs_no_match["form_link"] == ""
