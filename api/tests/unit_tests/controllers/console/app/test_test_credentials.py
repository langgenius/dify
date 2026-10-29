from flask import Flask

from controllers.console.app import test_credentials as controller
from controllers.console.app.workflow import (
    AdvancedChatWorkflowRunPayload,
    DraftWorkflowNodeRunPayload,
    DraftWorkflowRunPayload,
    IterationNodeRunPayload,
    LoopNodeRunPayload,
)
from tests.helpers.unit.controllers.error_body import raised_error
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


def test_run_error_includes_actionable_readiness(app: Flask) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a", None)]})

    @controller.test_credential_errors
    def run() -> None:
        harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None)

    with app.test_request_context("/run", method="POST"):
        body, status = raised_error(run)
    assert status == 400
    assert body["code"] == "test_credentials_not_ready"
    assert body["details"] == {
        "ready": False,
        "credentials": [
            {
                "node_id": "a",
                "node_ids": ["a"],
                "credential_id": None,
                "status": "disconnected",
                "check": None,
            }
        ],
    }


def test_run_payloads_keep_the_existing_inputs_without_a_draft_hash() -> None:
    for model in (
        AdvancedChatWorkflowRunPayload,
        DraftWorkflowNodeRunPayload,
        DraftWorkflowRunPayload,
        IterationNodeRunPayload,
        LoopNodeRunPayload,
    ):
        payload = model.model_validate({"inputs": {}})
        assert "draft_hash" not in payload.model_dump()
        assert "draft_hash" not in model.model_fields
