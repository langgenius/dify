import logging

from celery import shared_task

from extensions.ext_database import db
from models import Account
from services.billing_service import BillingService
from tasks.mail_account_deletion_task import send_deletion_success_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_account_task(account_id):
    account = db.session.query(Account).where(Account.id == account_id).first()
    try:
        BillingService.delete_account(account_id)
    except Exception:
        logger.exception("Failed to delete account %s from billing service.", account_id)
        raise

    if not account:
        logger.error("Account %s not found.", account_id)
        return
    # send success email
    send_deletion_success_task.delay(account.email)
