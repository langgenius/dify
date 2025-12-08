import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import click
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.workflow.nodes.human_input.entities import EmailDeliveryConfig, EmailDeliveryMethod
from extensions.ext_database import db
from extensions.ext_mail import mail
from libs.email_template_renderer import render_email_template
from models.human_input import (
    DeliveryMethodType,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _EmailRecipient:
    email: str
    token: str


@dataclass(frozen=True)
class _EmailDeliveryJob:
    form_id: str
    workflow_run_id: str
    subject: str
    body: str
    form_content: str
    recipients: list[_EmailRecipient]


def _build_form_link(token: str | None) -> str | None:
    if not token:
        return None
    base_url = dify_config.CONSOLE_WEB_URL
    if not base_url:
        return None
    return f"{base_url.rstrip('/')}/api/form/human_input/{token}"


def _parse_recipient_payload(payload: str) -> tuple[str | None, RecipientType | None]:
    try:
        payload_dict: dict[str, Any] = json.loads(payload)
    except Exception:
        logger.exception("Failed to parse recipient payload")
        return None, None

    return payload_dict.get("email"), payload_dict.get("TYPE")


def _load_email_jobs(session: Session, form_id: str) -> list[_EmailDeliveryJob]:
    form = session.get(HumanInputForm, form_id)
    if form is None:
        logger.warning("Human input form not found, form_id=%s", form_id)
        return []

    deliveries = session.scalars(
        select(HumanInputDelivery).where(
            HumanInputDelivery.form_id == form_id,
            HumanInputDelivery.delivery_method_type == DeliveryMethodType.EMAIL,
        )
    ).all()
    jobs: list[_EmailDeliveryJob] = []
    for delivery in deliveries:
        delivery_config = EmailDeliveryMethod.model_validate_json(delivery.channel_payload)

        recipients = session.scalars(
            select(HumanInputFormRecipient).where(HumanInputFormRecipient.delivery_id == delivery.id)
        ).all()

        recipient_entities: list[_EmailRecipient] = []
        for recipient in recipients:
            email, recipient_type = _parse_recipient_payload(recipient.recipient_payload)
            if recipient_type not in {RecipientType.EMAIL_MEMBER, RecipientType.EMAIL_EXTERNAL}:
                continue
            if not email:
                continue
            token = recipient.access_token
            if not token:
                continue
            recipient_entities.append(_EmailRecipient(email=email, token=token))

        if not recipient_entities:
            continue

        jobs.append(
            _EmailDeliveryJob(
                form_id=form_id,
                workflow_run_id=form.workflow_run_id,
                subject=delivery_config.config.subject,
                body=delivery_config.config.body,
                form_content=form.rendered_content,
                recipients=recipient_entities,
            )
        )
    return jobs


def _render_subject(subject_template: str, substitutions: dict[str, str]) -> str:
    return render_email_template(subject_template, substitutions)


def _render_body(body_template: str, substitutions: dict[str, str]) -> str:
    templated_body = EmailDeliveryConfig.replace_url_placeholder(body_template, substitutions.get("form_link"))
    return render_email_template(templated_body, substitutions)


def _build_substitutions(
    *,
    job: _EmailDeliveryJob,
    recipient: _EmailRecipient,
    node_title: str | None,
) -> dict[str, str]:
    raw_values: dict[str, str | None] = {
        "form_id": job.form_id,
        "workflow_run_id": job.workflow_run_id,
        "node_title": node_title,
        "form_token": recipient.token,
        "form_link": _build_form_link(recipient.token),
        "form_content": job.form_content,
        "recipient_email": recipient.email,
    }
    return {key: value or "" for key, value in raw_values.items()}


def _open_session(session_factory: sessionmaker | Session | None):
    if session_factory is None:
        return Session(db.engine)
    if isinstance(session_factory, Session):
        return session_factory
    return session_factory()


@shared_task(queue="mail")
def dispatch_human_input_email_task(form_id: str, node_title: str | None = None, session_factory=None):
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start human input email delivery for form {form_id}", fg="green"))
    start_at = time.perf_counter()

    try:
        with _open_session(session_factory) as session:
            jobs = _load_email_jobs(session, form_id)

        for job in jobs:
            for recipient in job.recipients:
                substitutions = _build_substitutions(job=job, recipient=recipient, node_title=node_title)
                subject = _render_subject(job.subject, substitutions)
                body = _render_body(job.body, substitutions)

                mail.send(
                    to=recipient.email,
                    subject=subject,
                    html=body,
                )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Human input email delivery succeeded for form {form_id}: latency: {end_at - start_at}", fg="green"
            )
        )
    except Exception:
        logger.exception("Send human input email failed, form_id=%s", form_id)
