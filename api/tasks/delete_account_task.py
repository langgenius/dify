import logging

from celery import shared_task

from configs import dify_config
from core.db.session_factory import session_factory
from models import Account
from services.billing_service import BillingService
from tasks.mail_account_deletion_task import send_deletion_success_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_account_task(account_id):
    with session_factory.create_session() as session:
        logger.info("delete_account_task: account_id: %s", account_id)
        account = session.query(Account).where(Account.id == account_id).first()
        try:
            if dify_config.BILLING_ENABLED:
                logger.info("delete_account_task: before delete_account: %s", account_id)
                BillingService.delete_account(account_id)
                logger.info("delete_account_task: after delete_account: %s", account_id)
        except Exception:
            logger.exception("Failed to delete account %s from billing service.", account_id)
            raise

        if not account:
            logger.error("Account %s not found.", account_id)
            return
        # send success email
        send_deletion_success_task.delay(account.email)
        logger.info("delete_account_task: delete_account successfully: %s", account_id)
