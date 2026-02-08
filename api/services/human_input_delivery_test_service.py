from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.workflow.nodes.human_input.entities import (
    DeliveryChannelConfig,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    ExternalRecipient,
    MemberRecipient,
)
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from extensions.ext_mail import mail
from libs.email_template_renderer import render_email_template
from models import Account, TenantAccountJoin
from services.feature_service import FeatureService


class DeliveryTestStatus(StrEnum):
    OK = "ok"
    FAILED = "failed"


@dataclass(frozen=True)
class DeliveryTestEmailRecipient:
    email: str
    form_token: str


@dataclass(frozen=True)
class DeliveryTestContext:
    tenant_id: str
    app_id: str
    node_id: str
    node_title: str | None
    rendered_content: str
    template_vars: dict[str, str] = field(default_factory=dict)
    recipients: list[DeliveryTestEmailRecipient] = field(default_factory=list)
    variable_pool: VariablePool | None = None


@dataclass(frozen=True)
class DeliveryTestResult:
    status: DeliveryTestStatus
    delivered_to: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class DeliveryTestError(Exception):
    pass


class DeliveryTestUnsupportedError(DeliveryTestError):
    pass


def _build_form_link(token: str | None) -> str | None:
    if not token:
        return None
    base_url = dify_config.APP_WEB_URL
    if not base_url:
        return None
    return f"{base_url.rstrip('/')}/form/{token}"


class DeliveryTestHandler(Protocol):
    def supports(self, method: DeliveryChannelConfig) -> bool: ...

    def send_test(
        self,
        *,
        context: DeliveryTestContext,
        method: DeliveryChannelConfig,
    ) -> DeliveryTestResult: ...


class DeliveryTestRegistry:
    def __init__(self, handlers: list[DeliveryTestHandler] | None = None) -> None:
        self._handlers = list(handlers or [])

    def register(self, handler: DeliveryTestHandler) -> None:
        self._handlers.append(handler)

    def dispatch(
        self,
        *,
        context: DeliveryTestContext,
        method: DeliveryChannelConfig,
    ) -> DeliveryTestResult:
        for handler in self._handlers:
            if handler.supports(method):
                return handler.send_test(context=context, method=method)
        raise DeliveryTestUnsupportedError("Delivery method does not support test send.")

    @classmethod
    def default(cls) -> DeliveryTestRegistry:
        return cls([EmailDeliveryTestHandler()])


class HumanInputDeliveryTestService:
    def __init__(self, registry: DeliveryTestRegistry | None = None) -> None:
        self._registry = registry or DeliveryTestRegistry.default()

    def send_test(
        self,
        *,
        context: DeliveryTestContext,
        method: DeliveryChannelConfig,
    ) -> DeliveryTestResult:
        return self._registry.dispatch(context=context, method=method)


class EmailDeliveryTestHandler:
    def __init__(self, session_factory: sessionmaker | Engine | None = None) -> None:
        if session_factory is None:
            session_factory = sessionmaker(bind=db.engine)
        elif isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory

    def supports(self, method: DeliveryChannelConfig) -> bool:
        return isinstance(method, EmailDeliveryMethod)

    def send_test(
        self,
        *,
        context: DeliveryTestContext,
        method: DeliveryChannelConfig,
    ) -> DeliveryTestResult:
        if not isinstance(method, EmailDeliveryMethod):
            raise DeliveryTestUnsupportedError("Delivery method does not support test send.")
        features = FeatureService.get_features(context.tenant_id)
        if not features.human_input_email_delivery_enabled:
            raise DeliveryTestError("Email delivery is not available for current plan.")
        if not mail.is_inited():
            raise DeliveryTestError("Mail client is not initialized.")

        recipients = self._resolve_recipients(
            tenant_id=context.tenant_id,
            method=method,
        )
        if not recipients:
            raise DeliveryTestError("No recipients configured for delivery method.")

        delivered: list[str] = []
        for recipient_email in recipients:
            substitutions = self._build_substitutions(
                context=context,
                recipient_email=recipient_email,
            )
            subject = render_email_template(method.config.subject, substitutions)
            templated_body = EmailDeliveryConfig.render_body_template(
                body=method.config.body,
                url=substitutions.get("form_link"),
                variable_pool=context.variable_pool,
            )
            body = render_email_template(templated_body, substitutions)

            mail.send(
                to=recipient_email,
                subject=subject,
                html=body,
            )
            delivered.append(recipient_email)

        return DeliveryTestResult(status=DeliveryTestStatus.OK, delivered_to=delivered)

    def _resolve_recipients(self, *, tenant_id: str, method: EmailDeliveryMethod) -> list[str]:
        recipients = method.config.recipients
        emails: list[str] = []
        member_user_ids: list[str] = []
        for recipient in recipients.items:
            if isinstance(recipient, MemberRecipient):
                member_user_ids.append(recipient.user_id)
            elif isinstance(recipient, ExternalRecipient):
                if recipient.email:
                    emails.append(recipient.email)

        if recipients.whole_workspace:
            member_user_ids = []
            member_emails = self._query_workspace_member_emails(tenant_id=tenant_id, user_ids=None)
            emails.extend(member_emails.values())
        elif member_user_ids:
            member_emails = self._query_workspace_member_emails(tenant_id=tenant_id, user_ids=member_user_ids)
            for user_id in member_user_ids:
                email = member_emails.get(user_id)
                if email:
                    emails.append(email)

        return list(dict.fromkeys([email for email in emails if email]))

    def _query_workspace_member_emails(
        self,
        *,
        tenant_id: str,
        user_ids: list[str] | None,
    ) -> dict[str, str]:
        if user_ids is None:
            unique_ids = None
        else:
            unique_ids = {user_id for user_id in user_ids if user_id}
            if not unique_ids:
                return {}

        stmt = (
            select(Account.id, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == tenant_id)
        )
        if unique_ids is not None:
            stmt = stmt.where(Account.id.in_(unique_ids))

        with self._session_factory() as session:
            rows = session.execute(stmt).all()
        return dict(rows)

    @staticmethod
    def _build_substitutions(
        *,
        context: DeliveryTestContext,
        recipient_email: str,
    ) -> dict[str, str]:
        raw_values: dict[str, str | None] = {
            "form_id": "",
            "node_title": context.node_title,
            "workflow_run_id": "",
            "form_token": "",
            "form_link": "",
            "form_content": context.rendered_content,
            "recipient_email": recipient_email,
        }
        substitutions = {key: value or "" for key, value in raw_values.items()}
        if context.template_vars:
            substitutions.update({key: value for key, value in context.template_vars.items() if value is not None})
        token = next(
            (recipient.form_token for recipient in context.recipients if recipient.email == recipient_email),
            None,
        )
        if token:
            substitutions["form_token"] = token
            substitutions["form_link"] = _build_form_link(token) or ""
        return substitutions
