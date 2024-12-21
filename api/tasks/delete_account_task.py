import logging
import time

import click
from celery import shared_task
from extensions.ext_database import db
from models.account import (Account, Tenant, TenantAccountJoin,
                            TenantAccountJoinRole)
from services.account_deletion_log_service import AccountDeletionLogService
from services.billing_service import BillingService
from tasks.mail_account_deletion_task import (send_deletion_fail_task,
                                              send_deletion_success_task)

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def delete_account_task(account: Account, reason: str):
    logger.info(click.style("Start delete account task.", fg="green"))
    start_at = time.perf_counter()

    logger.info(f"Start deletion of account {account.email}.")
    try:
        tenant_account_joins = db.session.query(TenantAccountJoin).filter(TenantAccountJoin.account_id == account.id).all()
        with db.session.begin():
            # find all tenants this account belongs to
            for ta in tenant_account_joins:
                if ta.role == TenantAccountJoinRole.OWNER:
                    # dismiss all members of the tenant
                    members = db.session.query(TenantAccountJoin).filter(TenantAccountJoin.tenant_id == ta.tenant_id).delete()
                    logging.info(f"Dismissed {members} members from tenant {ta.tenant_id}.")

                    # delete the tenant
                    db.session.query(Tenant).filter(Tenant.id == ta.tenant_id).delete()
                    logging.info(f"Deleted tenant {ta.tenant_id}.")

                    # delete subscription
                    try:
                        BillingService.delete_tenant_customer(ta.tenant_id)
                    except Exception as e:
                        logging.error(f"Failed to delete subscription for tenant {ta.tenant_id}: {e}.")
                        raise
                else:
                    # remove the account from tenant
                    db.session.delete(ta)
                    logging.info(f"Removed account {account.email} from tenant {ta.tenant_id}.")

            # delete the account
            db.session.delete(account)

            # prepare account deletion log
            account_deletion_log = AccountDeletionLogService.create_account_deletion_log(account.email, reason)
            db.session.add(account_deletion_log)

    except Exception as e:
        logging.error(f"Failed to delete account {account.email}.")
        send_deletion_fail_task.delay(account.interface_language, account.email)
        return

    send_deletion_success_task.delay(account.interface_language, account.email)
    end_at = time.perf_counter()
    logging.info(
        click.style(
            "Account deletion task completed: latency: {}".format(end_at - start_at), fg="green"
        )
    )
