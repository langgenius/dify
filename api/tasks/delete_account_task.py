import logging

from celery import shared_task
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from models import Account, AccountStatus
from services.billing_service import BillingService
from tasks.mail_account_deletion_task import send_deletion_success_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, queue="dataset")
def delete_account_task(self, account_id: str) -> None:
    with session_factory.create_session() as session:
        account = session.scalar(select(Account).where(Account.id == account_id).limit(1))
        if not account:
            logger.error("Account %s not found.", account_id)
            return
        if account.status != AccountStatus.CLOSED:
            raise self.retry(countdown=5, max_retries=12)
        email = account.email

    try:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.delete_account(account_id)
    except Exception as exc:
        logger.exception("Failed to delete account %s from billing service.", account_id)
        raise self.retry(exc=exc, countdown=5, max_retries=12)

    try:
        send_deletion_success_task.delay(email)
    except Exception:
        logger.exception("Failed to queue account deletion confirmation for %s.", account_id)
