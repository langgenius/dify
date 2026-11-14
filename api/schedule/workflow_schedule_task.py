"""Celery beat entry point for due workflow schedule polling."""

from celery import shared_task

from extensions.ext_application_services import application_services


@shared_task(queue="schedule_poller")
def poll_workflow_schedules() -> None:
    application_services().triggers.schedules.poll()
