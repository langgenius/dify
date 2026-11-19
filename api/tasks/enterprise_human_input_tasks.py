"""Enterprise-only durable run-effect outbox polling."""

from celery import shared_task

from core.db.session_factory import session_factory
from services.enterprise.human_input_run_gateway import drain_pending_run_effects


@shared_task(name="enterprise_human_input.deliver_run_effects", queue="schedule_executor")
def deliver_run_effects() -> None:
    """Retry committed effects; unacknowledged rows remain discoverable indefinitely."""
    drain_pending_run_effects(session_factory.get_session_maker())
