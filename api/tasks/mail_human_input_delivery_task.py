import logging
import time

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
    HumanInputFormDeliveryDispatcher,
    HumanInputFormDeliveryProviderRegistry,
)

logger = logging.getLogger(__name__)


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
            features = FeatureService.get_features(form.tenant_id, exclude_vector_space=True)
            if not features.human_input_email_delivery_enabled:
                logger.info(
                    "Human input email delivery is not available for tenant=%s, form_id=%s",
                    form.tenant_id,
                    form_id,
                )
                return
            variable_pool = _load_variable_pool(form.workflow_run_id)
            registry = HumanInputFormDeliveryProviderRegistry.default(mail_client=mail)
            dispatcher = HumanInputFormDeliveryDispatcher(registry=registry)
            dispatcher.dispatch_form(
                session=session,
                form=form,
                variable_pool=variable_pool,
                delivery_method_types=(DeliveryMethodType.EMAIL,),
            )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Human input email delivery succeeded for form {form_id}: latency: {end_at - start_at}", fg="green"
            )
        )
    except Exception:
        logger.exception("Send human input email failed, form_id=%s", form_id)
