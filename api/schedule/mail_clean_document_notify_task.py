import logging
import time
from collections import defaultdict

import click
from flask import render_template  # type: ignore

import app
from configs import dify_config
from extensions.ext_database import db
from extensions.ext_mail import mail
from models.account import Account, Tenant, TenantAccountJoin
from models.dataset import Dataset, DatasetAutoDisableLog
from services.feature_service import FeatureService


@app.celery.task(queue="dataset")
def send_document_clean_notify_task():
    """
    Async Send document clean notify mail

    Usage: send_document_clean_notify_task.delay()
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start send document clean notify mail", fg="green"))
    start_at = time.perf_counter()

    # send document clean notify mail
    try:
        dataset_auto_disable_logs = DatasetAutoDisableLog.query.filter(DatasetAutoDisableLog.notified == False).all()
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
                tenant = Tenant.query.filter(Tenant.id == tenant_id).first()
                if not tenant:
                    continue
                # check current owner
                current_owner_join = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, role="owner").first()
                if not current_owner_join:
                    continue
                account = Account.query.filter(Account.id == current_owner_join.account_id).first()
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
                    dataset = Dataset.query.filter(Dataset.id == dataset_id).first()
                    if dataset:
                        document_count = len(document_ids)
                        knowledge_details.append(rf"Knowledge base {dataset.name}: {document_count} documents")
                if knowledge_details:
                    html_content = render_template(
                        "clean_document_job_mail_template-US.html",
                        userName=account.email,
                        knowledge_details=knowledge_details,
                        url=url,
                    )
                    mail.send(
                        to=account.email, subject="Dify Knowledge base auto disable notification", html=html_content
                    )

            # update notified to True
            for dataset_auto_disable_log in tenant_dataset_auto_disable_logs:
                dataset_auto_disable_log.notified = True
            db.session.commit()
        end_at = time.perf_counter()
        logging.info(
            click.style("Send document clean notify mail succeeded: latency: {}".format(end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("Send document clean notify mail failed")
