"""Periodic Guest Connection retention on the existing retention queue."""

from celery import shared_task

from configs import dify_config
from core.db.session_factory import session_factory
from extensions.application_services.end_user_connections import build_guest_connection_expiry


@shared_task(queue="retention")
def cleanup_guest_connections() -> None:
    """Use server-side settings only; committed rows remain settled on redelivery."""
    if dify_config.ENABLE_GUEST_CONNECTION_CLEANUP_TASK:
        try:
            build_guest_connection_expiry(database_client=session_factory.get_session_maker()).run()
        except Exception:
            # The worker logs uncaught exceptions. Do not forward SQL or provider diagnostics.
            raise RuntimeError("Could not sweep Guest Connection retention.") from None
