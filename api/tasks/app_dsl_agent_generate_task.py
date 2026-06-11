from celery import shared_task

from services.app_dsl_agent_service import app_dsl_agent_run_store


@shared_task(queue="workflow_based_app_execution")
def run_app_dsl_agent_generation_task(run_id: str) -> bool:
    return app_dsl_agent_run_store.execute_run(run_id)
