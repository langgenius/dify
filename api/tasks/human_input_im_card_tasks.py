"""Independent Celery follow-up for one committed Human Input card delivery."""

import logging

from celery import shared_task
from sqlalchemy.exc import SQLAlchemyError

from core.db.session_factory import session_factory
from core.human_input_v2.shared.values import TenantId
from services.human_input_v2.im_card_service import HumanInputIMCardService, IMCardUpdateRetryableError
from services.human_input_v2.im_credential_codec import IMCredentialError

logger = logging.getLogger(__name__)
_MAX_RETRIES = 5


@shared_task(
    queue="human_input_delivery",
    autoretry_for=(IMCardUpdateRetryableError, IMCredentialError, SQLAlchemyError, OSError),
    retry_backoff=True,
    retry_kwargs={"max_retries": _MAX_RETRIES},
    acks_late=True,
    reject_on_worker_lost=True,
)
def update_human_input_im_card_task(tenant_id: str, form_id: str, delivery_id: str) -> None:
    logger.info(
        "Human Input IM card update received tenant_id=%s form_id=%s delivery_id=%s", tenant_id, form_id, delivery_id
    )
    HumanInputIMCardService(session_factory=session_factory.get_session_maker()).update_card(
        tenant_id=TenantId(tenant_id), form_id=form_id, delivery_id=delivery_id
    )
