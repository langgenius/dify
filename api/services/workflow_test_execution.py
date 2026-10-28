"""Bridge legacy debug entry points to the Builder credential application service."""

from collections.abc import Mapping
from typing import Any

from models.account import Account
from models.model import App
from models.workflow import Workflow
from services.workflow.tool_credentials import requires_end_user_connections
from services.workflow_test_credentials import BuilderScope, TestCredentialDraftChangedError


def prepare_workflow_test_execution(
    *, app: App, user: Account, workflow: Workflow, args: Mapping[str, Any], node_id: str | None
) -> dict[str, Any]:
    draft_hash = args.get("draft_hash")
    if not requires_end_user_connections(workflow.graph_dict) and draft_hash is None:
        return dict(args)
    if (
        workflow.tenant_id != app.tenant_id
        or workflow.app_id != app.id
        or workflow.version != Workflow.VERSION_DRAFT
        or (draft_hash is not None and draft_hash != workflow.unique_hash)
    ):
        raise TestCredentialDraftChangedError()
    from extensions.ext_application_services import application_services

    result = application_services().workflow_test_credentials.require_ready(
        BuilderScope(app.tenant_id, app.id, user.id), draft_hash=draft_hash, node_id=node_id
    )
    if result.draft_hash != workflow.unique_hash:
        raise TestCredentialDraftChangedError()
    return {**args, "draft_hash": result.draft_hash}
