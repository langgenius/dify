"""Execute one schedule through the injected schedule application service."""

from celery import shared_task

from extensions.ext_application_services import application_services


@shared_task(queue="schedule_executor")
def run_schedule_trigger(schedule_id: str) -> None:
    # Schedules repeat at their next interval; preserve the existing no-retry policy.
    application_services().triggers.schedules.execute(schedule_id)
