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
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.workflow.nodes.human_input.entities import EmailDeliveryConfig, EmailDeliveryMethod
from core.workflow.runtime import GraphRuntimeState, VariablePool
from extensions.ext_database import db
from extensions.ext_mail import mail
from models.human_input import (
    DeliveryMethodType,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
)
from repositories.factory import DifyAPIRepositoryFactory
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _EmailRecipient:
    email: str
    token: str


@dataclass(frozen=True)
class _EmailDeliveryJob:
    form_id: str
    subject: str
    body: str
    form_content: str
    recipients: list[_EmailRecipient]


def _build_form_link(token: str) -> str:
    base_url = dify_config.APP_WEB_URL
    return f"{base_url.rstrip('/')}/form/{token}"


def _parse_recipient_payload(payload: str) -> tuple[str | None, RecipientType | None]:
    try:
        payload_dict: dict[str, Any] = json.loads(payload)
    except Exception:
        logger.exception("Failed to parse recipient payload")
        return None, None

    return payload_dict.get("email"), payload_dict.get("TYPE")


def _load_email_jobs(session: Session, form: HumanInputForm) -> list[_EmailDeliveryJob]:
    deliveries = session.scalars(
        select(HumanInputDelivery).where(
            HumanInputDelivery.form_id == form.id,
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
                form_id=form.id,
                subject=delivery_config.config.subject,
                body=delivery_config.config.body,
                form_content=form.rendered_content,
                recipients=recipient_entities,
            )
        )
    return jobs


def _render_body(
    body_template: str,
    form_link: str,
    *,
    variable_pool: VariablePool | None,
) -> str:
    body = EmailDeliveryConfig.render_body_template(
        body=body_template,
        url=form_link,
        variable_pool=variable_pool,
    )
    return body


def _load_variable_pool(workflow_run_id: str | None) -> VariablePool | None:
    if not workflow_run_id:
        return None

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)
    pause_entity = workflow_run_repo.get_workflow_pause(workflow_run_id)
    if pause_entity is None:
        logger.info("No pause state found for workflow run %s", workflow_run_id)
        return None

    try:
        resumption_context = WorkflowResumptionContext.loads(pause_entity.get_state().decode())
    except Exception:
        logger.exception("Failed to load resumption context for workflow run %s", workflow_run_id)
        return None

    graph_runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)
    return graph_runtime_state.variable_pool


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
            form = session.get(HumanInputForm, form_id)
            if form is None:
                logger.warning("Human input form not found, form_id=%s", form_id)
                return
            features = FeatureService.get_features(form.tenant_id)
            if not features.human_input_email_delivery_enabled:
                logger.info(
                    "Human input email delivery is not available for tenant=%s, form_id=%s",
                    form.tenant_id,
                    form_id,
                )
                return
            jobs = _load_email_jobs(session, form)

        variable_pool = _load_variable_pool(form.workflow_run_id)

        for job in jobs:
            for recipient in job.recipients:
                form_link = _build_form_link(recipient.token)
                body = _render_body(job.body, form_link, variable_pool=variable_pool)

                mail.send(
                    to=recipient.email,
                    subject=job.subject,
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
