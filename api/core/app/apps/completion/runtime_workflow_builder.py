from sqlalchemy.orm import Session

from core.app.apps.completion.app_config_manager import CompletionAppConfig
from models.model import App, AppMode
from services.workflow.workflow_converter import WorkflowConverter, WorkflowGraph


def build_runtime_completion_workflow(
    *,
    app_model: App,
    app_config: CompletionAppConfig,
    session: Session,
) -> WorkflowGraph:
    """Build the transient WorkflowEntry graph used by Completion execution."""
    graph, _ = WorkflowConverter().build_graph_from_app_config(
        app_model=app_model,
        app_config=app_config,
        target_app_mode=AppMode.WORKFLOW,
        session=session,
        use_sys_query_for_external_data=True,
    )
    return graph
