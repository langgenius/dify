"""Use existing Celery infrastructure to request one bounded E2B usage scan."""

import logging
from urllib.parse import urlsplit

from celery import shared_task
from pydantic import BaseModel, ConfigDict, StrictBool

from configs import dify_config
from core.helper import ssrf_proxy

logger = logging.getLogger(__name__)


class _CollectionResponse(BaseModel):
    completed: StrictBool
    model_config = ConfigDict(extra="ignore")


@shared_task(
    name="schedule.collect_agent_sandbox_usage.collect_agent_sandbox_usage",
    queue="ops_trace",
    soft_time_limit=270,
    time_limit=300,
    ignore_result=True,
)
def collect_agent_sandbox_usage() -> bool:
    """Accounting failures fail this job only; the next scheduled scan retries.

    No provider credential is copied to the API. The Agent's authenticated
    control plane owns its E2B client and executes one request-scoped scan.
    """
    if not dify_config.AGENT_SANDBOX_METERING_ENABLED:
        return False
    try:
        base_url = (dify_config.AGENT_BACKEND_BASE_URL or "").rstrip("/")
        token = (dify_config.AGENT_BACKEND_API_TOKEN or "").strip()
        project_id = dify_config.AGENT_SANDBOX_METERING_PROJECT_ID.strip()
        parsed = urlsplit(base_url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or not token
            or not project_id
        ):
            raise ValueError("Sandbox usage collection requires backend URL, token, and project configuration")
        response = ssrf_proxy.post(
            f"{base_url}/internal/e2b/usage/collect",
            headers={"Authorization": f"Bearer {token}"},
            json={"project_id": project_id},
            max_retries=0,
            timeout=260,
        )
        try:
            response.raise_for_status()
            completed = _CollectionResponse.model_validate(response.json()).completed
        finally:
            response.close()
        if not completed:
            raise RuntimeError("Sandbox usage collection did not complete its bounded scan")
    except Exception as exc:
        # Do not include credentials, response bodies, or provider metadata.
        logger.warning("Background sandbox usage collection failed", extra={"error_type": type(exc).__name__})
        raise
    logger.info("Background sandbox usage collection completed")
    return True
