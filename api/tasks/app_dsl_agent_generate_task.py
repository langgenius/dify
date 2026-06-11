from billiard.exceptions import SoftTimeLimitExceeded
from celery import shared_task

from services.app_dsl_agent_service import (
    DSL_AGENT_TASK_SOFT_TIME_LIMIT_SECONDS,
    DSL_AGENT_TASK_TIME_LIMIT_SECONDS,
    app_dsl_agent_run_store,
)


@shared_task(
    queue="workflow_based_app_execution",
    soft_time_limit=DSL_AGENT_TASK_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DSL_AGENT_TASK_TIME_LIMIT_SECONDS,
)
def run_app_dsl_agent_generation_task(run_id: str) -> bool:
    try:
        return app_dsl_agent_run_store.execute_run(run_id)
    except SoftTimeLimitExceeded:
        app_dsl_agent_run_store.fail_run(
            run_id,
            "DSL generation timed out. Try again or choose a faster generation model.",
            message="DSL generation run timed out.",
        )
        return False
