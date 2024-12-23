import logging
import time

import click
from celery import shared_task
from extensions.ext_database import db
from flask import jsonify
from models.account import (Account, AccountDeletionLogDetail,
                            TenantAccountJoin, TenantAccountJoinRole)
from services.account_deletion_log_service import AccountDeletionLogService
from services.billing_service import BillingService
from tasks.mail_account_deletion_task import send_deletion_success_task

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_account_task(account_id, reason: str):
    account = db.session.query(Account).filter(Account.id == account_id).first()
    if not account:
        logging.error(f"Account with ID {account_id} not found.")
        return

    logger.info(click.style(f"Start deletion task for account {account.email}.", fg="green"))
    start_at = time.perf_counter()

    try:
        _process_account_deletion(account, reason)
        db.session.commit()
        send_deletion_success_task.delay(account.interface_language, account.email)
        logger.info(
            click.style(
                f"Account deletion task completed for {account.email}: latency: {time.perf_counter() - start_at}",
                fg="green",
            )
        )
    except Exception as e:
        db.session.rollback()
        logging.error(f"Failed to delete account {account.email}: {e}.")
        raise


def _process_account_deletion(account, reason):
    # Fetch all tenant-account associations
    tenant_account_joins = db.session.query(TenantAccountJoin).filter(
        TenantAccountJoin.account_id == account.id
    ).all()

    for ta in tenant_account_joins:
        if ta.role == TenantAccountJoinRole.OWNER.value:
            _handle_owner_tenant_deletion(ta)
        else:
            _remove_account_from_tenant(ta, account.email)

    account_deletion_log = AccountDeletionLogService.create_account_deletion_log(
        account, reason
    )
    db.session.add(account_deletion_log)
    db.session.delete(account)
    logger.info(f"Account {account.email} successfully deleted.")


def _handle_owner_tenant_deletion(ta: TenantAccountJoin):
    """Handle deletion of a tenant where the account is an owner."""
    tenant_id = ta.tenant_id

    # Dismiss all tenant members
    members_to_dismiss = db.session.query(TenantAccountJoin).filter(
        TenantAccountJoin.tenant_id == tenant_id
    ).all()
    for member in members_to_dismiss:
        db.session.delete(member)
    logger.info(f"Dismissed {len(members_to_dismiss)} members from tenant {tenant_id}.")

    # Delete subscription
    try:
        BillingService.unsubscripbe_tenant_customer(tenant_id)
        logger.info(f"Subscription for tenant {tenant_id} deleted successfully.")
    except Exception as e:
        logger.error(f"Failed to delete subscription for tenant {tenant_id}: {e}.")
        raise

    # create account deletion log detail
    account_deletion_log_detail = AccountDeletionLogDetail()
    account_deletion_log_detail.account_id = ta.account_id
    account_deletion_log_detail.tenant_id = tenant_id
    account_deletion_log_detail.snapshot = jsonify({
        "tenant_account_join_info": ta,
        "dismissed_members": members_to_dismiss
    })
    account_deletion_log_detail.role = ta.role
    db.session.add(account_deletion_log_detail)


def _remove_account_from_tenant(ta, email):
    """Remove the account from a tenant."""
    tenant_id = ta.tenant_id
    db.session.delete(ta)
    logger.info(f"Removed account {email} from tenant {tenant_id}.")

    # create account deletion log detail
    account_deletion_log_detail = AccountDeletionLogDetail()
    account_deletion_log_detail.account_id = ta.account_id
    account_deletion_log_detail.tenant_id = tenant_id
    account_deletion_log_detail.snapshot = jsonify({
        "tenant_account_join_info": ta
    })
    account_deletion_log_detail.role = ta.role
    db.session.add(account_deletion_log_detail)
