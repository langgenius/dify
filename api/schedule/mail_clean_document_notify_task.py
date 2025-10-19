import logging
import time
from collections import defaultdict

import click
from sqlalchemy import select

import app
from configs import dify_config
from extensions.ext_database import db
from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service
from models import Account, Tenant, TenantAccountJoin
from models.dataset import Dataset, DatasetAutoDisableLog
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@app.celery.task(queue="dataset")
def mail_clean_document_notify_task():
    """
    Async Send document clean notify mail

    Usage: mail_clean_document_notify_task.delay()
    """
    if not mail.is_inited():
        return

    logger.info(click.style("Start send document clean notify mail", fg="green"))
    start_at = time.perf_counter()

    # send document clean notify mail
    try:
        dataset_auto_disable_logs = db.session.scalars(
            select(DatasetAutoDisableLog).where(DatasetAutoDisableLog.notified == False)
        ).all()
        # group by tenant_id
        dataset_auto_disable_logs_map: dict[str, list[DatasetAutoDisableLog]] = defaultdict(list)
        for dataset_auto_disable_log in dataset_auto_disable_logs:
            if dataset_auto_disable_log.tenant_id not in dataset_auto_disable_logs_map:
                dataset_auto_disable_logs_map[dataset_auto_disable_log.tenant_id] = []
            dataset_auto_disable_logs_map[dataset_auto_disable_log.tenant_id].append(dataset_auto_disable_log)
        url = f"{dify_config.CONSOLE_WEB_URL}/datasets"
        for tenant_id, tenant_dataset_auto_disable_logs in dataset_auto_disable_logs_map.items():
            features = FeatureService.get_features(tenant_id)
            plan = features.billing.subscription.plan
            if plan != "sandbox":
                knowledge_details = []
                # check tenant
                tenant = db.session.query(Tenant).where(Tenant.id == tenant_id).first()
                if not tenant:
                    continue
                # check current owner
                current_owner_join = (
                    db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, role="owner").first()
                )
                if not current_owner_join:
                    continue
                account = db.session.query(Account).where(Account.id == current_owner_join.account_id).first()
                if not account:
                    continue

                dataset_auto_dataset_map = {}  # type: ignore
                for dataset_auto_disable_log in tenant_dataset_auto_disable_logs:
                    if dataset_auto_disable_log.dataset_id not in dataset_auto_dataset_map:
                        dataset_auto_dataset_map[dataset_auto_disable_log.dataset_id] = []
                    dataset_auto_dataset_map[dataset_auto_disable_log.dataset_id].append(
                        dataset_auto_disable_log.document_id
                    )

                for dataset_id, document_ids in dataset_auto_dataset_map.items():
                    dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
                    if dataset:
                        document_count = len(document_ids)
                        knowledge_details.append(rf"Knowledge base {dataset.name}: {document_count} documents")
                if knowledge_details:
                    email_service = get_email_i18n_service()
                    email_service.send_email(
                        email_type=EmailType.DOCUMENT_CLEAN_NOTIFY,
                        language_code="en-US",
                        to=account.email,
                        template_context={
                            "userName": account.email,
                            "knowledge_details": knowledge_details,
                            "url": url,
                        },
                    )

            # update notified to True
            for dataset_auto_disable_log in tenant_dataset_auto_disable_logs:
                dataset_auto_disable_log.notified = True
            db.session.commit()
        end_at = time.perf_counter()
        logger.info(click.style(f"Send document clean notify mail succeeded: latency: {end_at - start_at}", fg="green"))
    except Exception:
        logger.exception("Send document clean notify mail failed")
