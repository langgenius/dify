"""Periodic recovery for abandoned trigger-debug handoffs and worker leases."""

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from extensions.application_services.workflow import build_workflow_debug_recovery_service
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now


@shared_task(queue="workflow_based_app_execution")
def recover_workflow_debug_reservations() -> None:
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    build_workflow_debug_recovery_service(sessions).recover_expired(naive_utc_now())
