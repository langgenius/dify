import logging
import time

import app

logger = logging.getLogger(__name__)


def _now_ts() -> int:
    return int(time.time())


@app.celery.task(queue="trigger_refresh")
def trigger_provider_refresh() -> None:
    """
    Simple trigger provider refresh task.
    - Scans due trigger subscriptions in small batches
    - Refreshes OAuth credentials if needed
    - Refreshes subscription metadata if needed
    """
    pass