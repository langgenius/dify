"""Check credentials from the graph the debug entry point is about to execute."""

from models.account import Account
from models.model import App
from models.workflow import Workflow
from services.workflow.tool_credentials import requires_end_user_connections
from services.workflow_test_credentials import BuilderScope, TestCredentialError


def require_workflow_test_credentials(*, app: App, user: Account, workflow: Workflow, node_id: str | None) -> None:
    graph = workflow.graph_dict
    if not requires_end_user_connections(graph):
        return
    if workflow.tenant_id != app.tenant_id or workflow.app_id != app.id or workflow.version != Workflow.VERSION_DRAFT:
        raise TestCredentialError("Test workflow does not belong to this App's draft.")
    from extensions.ext_application_services import application_services

    application_services().workflow_test_credentials.require_ready(
        BuilderScope(app.tenant_id, app.id, user.id), graph=graph, node_id=node_id
    )
