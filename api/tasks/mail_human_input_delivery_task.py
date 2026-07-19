"""Celery entrypoints for delivering persisted human input forms.

The generic form-delivery task must stay independent from email availability so
non-email providers can run even when mail is not configured. The legacy email
task keeps its historical mail and feature gates for callers that still need
email-only semantics.
"""

import logging
import time
from collections.abc import Sequence

import click
from celery import shared_task
from sqlalchemy.orm import Session, sessionmaker

from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.workflow.human_input_adapter import DeliveryMethodType
from extensions.ext_database import db
from extensions.ext_mail import mail
from graphon.runtime import GraphRuntimeState, VariablePool
from models.human_input import HumanInputForm
from repositories.factory import DifyAPIRepositoryFactory
from services.feature_service import FeatureService
from services.human_input_form_delivery_provider import (
    HumanInputFormDeliveryContext,
    HumanInputFormDeliveryDispatcher,
    HumanInputFormDeliveryProviderRegistry,
)

logger = logging.getLogger(__name__)

FORM_DELIVERY_METHOD_TYPES = (DeliveryMethodType.EMAIL, DeliveryMethodType.IM)


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


def _filter_unavailable_email_contexts(
    *,
    contexts: Sequence[HumanInputFormDeliveryContext],
    email_delivery_enabled: bool,
) -> tuple[HumanInputFormDeliveryContext, ...]:
    if mail.is_inited() and email_delivery_enabled:
        return tuple(contexts)

    return tuple(context for context in contexts if context.delivery_method_type != DeliveryMethodType.EMAIL)


def _load_and_dispatch_form_delivery(
    *,
    form_id: str,
    node_title: str | None,
    session_factory,
    delivery_method_types: Sequence[DeliveryMethodType] | None,
    require_mail_inited: bool,
    require_email_feature: bool,
    filter_unavailable_email: bool,
    log_label: str,
) -> None:
    if require_mail_inited and not mail.is_inited():
        return

    logger.info(click.style(f"Start human input {log_label} delivery for form {form_id}", fg="green"))
    start_at = time.perf_counter()

    try:
        with _open_session(session_factory) as session:
            form = session.get(HumanInputForm, form_id)
            if form is None:
                logger.warning("Human input form not found, form_id=%s", form_id)
                return

            features = FeatureService.get_features(form.tenant_id, exclude_vector_space=True)
            email_delivery_enabled = features.human_input_email_delivery_enabled
            if require_email_feature and not email_delivery_enabled:
                logger.info(
                    "Human input email delivery is not available for tenant=%s, form_id=%s",
                    form.tenant_id,
                    form_id,
                )
                return

            variable_pool = _load_variable_pool(form.workflow_run_id)
            registry = HumanInputFormDeliveryProviderRegistry.default(mail_client=mail)
            dispatcher = HumanInputFormDeliveryDispatcher(registry=registry)
            contexts = dispatcher.load_form_contexts(
                session=session,
                form=form,
                variable_pool=variable_pool,
                delivery_method_types=delivery_method_types,
            )

        if filter_unavailable_email:
            contexts = _filter_unavailable_email_contexts(
                contexts=contexts,
                email_delivery_enabled=email_delivery_enabled,
            )
        dispatcher.dispatch_contexts(contexts)

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Human input {log_label} delivery succeeded for form {form_id}: latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception(
            "Dispatch human input %s delivery failed, form_id=%s, node_title=%s",
            log_label,
            form_id,
            node_title,
        )


@shared_task(queue="mail")
def dispatch_human_input_form_delivery_task(form_id: str, node_title: str | None = None, session_factory=None):
    _load_and_dispatch_form_delivery(
        form_id=form_id,
        node_title=node_title,
        session_factory=session_factory,
        delivery_method_types=FORM_DELIVERY_METHOD_TYPES,
        require_mail_inited=False,
        require_email_feature=False,
        filter_unavailable_email=True,
        log_label="form",
    )


@shared_task(queue="mail")
def dispatch_human_input_email_task(form_id: str, node_title: str | None = None, session_factory=None):
    _load_and_dispatch_form_delivery(
        form_id=form_id,
        node_title=node_title,
        session_factory=session_factory,
        delivery_method_types=(DeliveryMethodType.EMAIL,),
        require_mail_inited=True,
        require_email_feature=True,
        filter_unavailable_email=False,
        log_label="email",
    )
