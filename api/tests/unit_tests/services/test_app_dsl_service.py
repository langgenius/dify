from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest

from graphon.enums import BuiltinNodeTypes
from models import App
from services import app_dsl_service
from services.app_dsl_service import AppDslService
from services.errors.app import WorkflowAgentNodeDslExportUnsupportedError


def test_append_workflow_export_data_rejects_agent_v2_nodes(monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        to_dict=lambda *, include_secret: {
            "graph": {
                "nodes": [
                    {
                        "id": "agent-node",
                        "data": {
                            "type": BuiltinNodeTypes.AGENT,
                            "version": "2",
                        },
                    }
                ]
            }
        }
    )
    workflow_service = Mock()
    workflow_service.get_draft_workflow.return_value = workflow
    monkeypatch.setattr(app_dsl_service, "WorkflowService", lambda: workflow_service)

    with pytest.raises(
        WorkflowAgentNodeDslExportUnsupportedError,
        match="Workflow DSL export does not support Agent nodes yet.",
    ):
        AppDslService._append_workflow_export_data(
            export_data={},
            app_model=cast(App, SimpleNamespace(tenant_id="tenant-1")),
            include_secret=False,
        )
