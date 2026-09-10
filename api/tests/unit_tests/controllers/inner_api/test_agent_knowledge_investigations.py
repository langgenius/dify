"""Queue admission and authorization boundaries for runtime quality reports."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from dify_agent.protocol.knowledge_fs import KnowledgeFsError
from flask import Flask
from flask_restx.swagger import Swagger

from controllers.inner_api import api as inner_api
from controllers.inner_api import bp as inner_api_bp
from tests.unit_tests.config_override import config_overrides_context

PATH = "/inner/api/agent/knowledge/investigations"
HEADERS = {"X-Inner-Api-Key": "inner-key"}


def _report() -> dict:
    spaces = [str(uuid4()), str(uuid4())]
    return {
        "investigation_id": str(uuid4()),
        "execution_context": {"tenant_id": "tenant", "agent_mode": "agent_app", "invoke_from": "published"},
        "bindings": [
            {"id": f"docs-{i}", "name": f"Docs {i}", "control_space_id": space} for i, space in enumerate(spaces)
        ],
        "query": "refund and renewal pricing",
        "status": "completed",
        "attempts": [
            {
                "command_id": str(uuid4()),
                "control_space_id": space,
                "command": "search",
                "outcome": "empty",
                "started_at_ms": 1,
                "elapsed_ms": 1,
                "delivered": True,
            }
            for space in [*spaces, spaces[0]]
        ],
    }


@pytest.fixture
def boundary():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)
    with (
        config_overrides_context(PLUGIN_DAEMON_KEY="plugin-key", INNER_API_KEY_FOR_PLUGIN="inner-key"),
        patch("controllers.console.wraps._is_setup_completed", return_value=True),
        patch("controllers.inner_api.agent.knowledge.AgentKnowledgeGateway") as gateway,
        patch(
            "tasks.knowledge_fs_agent_investigation_tasks.capture_agent_knowledge_investigation_task.delay"
        ) as enqueue,
    ):
        yield app.test_client(), gateway.return_value, enqueue


def test_queues_once_per_space_with_original_identity(boundary) -> None:
    client, gateway, enqueue = boundary
    payload = _report()
    response = client.post(PATH, json=payload, headers=HEADERS)

    assert response.status_code == 202
    assert response.get_json() == {"accepted": True}
    gateway.authorize_investigation.assert_called_once()
    assert enqueue.call_count == 2
    assert {call.kwargs["control_space_id"] for call in enqueue.call_args_list} == {
        binding["control_space_id"] for binding in payload["bindings"]
    }
    assert all(
        call.kwargs["report"]["investigation_id"] == payload["investigation_id"] for call in enqueue.call_args_list
    )
    gateway.capture_investigation.assert_not_called()


def test_revoked_scope_cannot_enqueue_a_report(boundary) -> None:
    client, gateway, enqueue = boundary
    gateway.authorize_investigation.side_effect = KnowledgeFsError("KNOWLEDGE_SCOPE_MISMATCH", "revoked", 403)
    assert client.post(PATH, json=_report(), headers=HEADERS).status_code == 403
    enqueue.assert_not_called()


def test_broker_failure_is_not_acknowledged_as_accepted(boundary) -> None:
    client, _, enqueue = boundary
    enqueue.side_effect = OSError("broker offline")
    assert client.post(PATH, json=_report(), headers=HEADERS).status_code == 500


def test_missing_inner_api_key_cannot_enqueue_a_report(boundary) -> None:
    client, gateway, enqueue = boundary
    assert client.post(PATH, json=_report()).status_code == 404
    gateway.authorize_investigation.assert_not_called()
    enqueue.assert_not_called()


def test_swagger_documents_report_and_queue_admission(boundary) -> None:
    client, _, _ = boundary
    with client.application.test_request_context():
        schema = Swagger(inner_api).as_dict()
    route = schema["paths"]["/agent/knowledge/investigations"]["post"]
    assert route["requestBody"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/KnowledgeInvestigationPayload"
    )
    assert route["responses"]["202"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/KnowledgeInvestigationAcceptedResponse"
    )
