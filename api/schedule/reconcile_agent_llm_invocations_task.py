"""Reconcile Agent LLM gateway calls left non-terminal by interrupted API workers."""

import logging
from datetime import timedelta

import app
from configs import dify_config
from services.agent_llm_inner_service import AgentLLMInnerService

logger = logging.getLogger(__name__)


@app.celery.task(queue="retention")
def reconcile_agent_llm_invocations() -> None:
    reconciled = AgentLLMInnerService.reconcile_stale(
        stale_after=timedelta(seconds=dify_config.AGENT_LLM_INVOCATION_STALE_AFTER_SECONDS),
        limit=dify_config.AGENT_LLM_INVOCATION_RECONCILIATION_BATCH_SIZE,
    )
    if reconciled:
        logger.info("Reconciled %d interrupted Agent LLM invocation(s)", reconciled)


__all__ = ["reconcile_agent_llm_invocations"]
