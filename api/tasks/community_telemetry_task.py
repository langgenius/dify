import logging

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from services.telemetry_service import CommunityTelemetryService

logger = logging.getLogger(__name__)


@shared_task(name="community_telemetry.send_heartbeat", queue="schedule_executor")
def send_community_telemetry_heartbeat() -> None:
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_factory() as session:
        try:
            CommunityTelemetryService.report_heartbeat(session=session)
        except Exception:
            logger.debug("Failed to process community telemetry heartbeat", exc_info=True)
