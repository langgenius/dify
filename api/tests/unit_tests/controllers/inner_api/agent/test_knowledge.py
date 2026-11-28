"""Queue admission and authorization boundaries for runtime quality reports."""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import TypedDict
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx.swagger import Swagger
from redis import Redis
from sqlalchemy.orm import Session, sessionmaker

from controllers.inner_api import api as inner_api
from controllers.inner_api import bp as inner_api_bp
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from models.account import TenantAccountJoin
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.model import App, AppMode
from tests.helpers.unit.config_override import config_overrides_context

PATH = "/inner/api/agent/knowledge/investigations"
HEADERS = {"X-Inner-Api-Key": "inner-key"}


class _Report(TypedDict):
    investigation_id: str
    execution_context: dict[str, str]
    bindings: list[dict[str, str]]
    query: str
    status: str
    attempts: list[dict[str, object]]


def _report() -> _Report:
    spaces = [str(uuid4()), str(uuid4())]
    return {
        "investigation_id": str(uuid4()),
        "execution_context": {
            "tenant_id": "tenant",
            "app_id": "app",
            "agent_id": "agent",
            "user_id": "account",
            "user_from": "account",
            "agent_mode": "agent_app",
            "invoke_from": "published",
            "agent_config_version_id": "snapshot",
            "agent_config_version_kind": "snapshot",
        },
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


@dataclass(frozen=True)
class _Boundary:
    client: FlaskClient
    payload: _Report
    enqueue: MagicMock


@pytest.fixture
def boundary(sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Boundary]:
    """Bind the real knowledge gateway and intercept publication at the broker boundary."""
    payload = _report()
    snapshot = AgentConfigSnapshot(
        tenant_id="tenant",
        agent_id="agent",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate({"knowledge": {"spaces": payload["bindings"]}}),
    )
    snapshot.id = "snapshot"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                App(
                    id="app",
                    tenant_id="tenant",
                    name="Agent",
                    mode=AppMode.AGENT,
                    status=AppStatus.NORMAL,
                    enable_site=True,
                    enable_api=True,
                    max_active_requests=0,
                ),
                Agent(
                    id="agent",
                    tenant_id="tenant",
                    name="Agent",
                    app_id="app",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.AGENT_APP,
                ),
                TenantAccountJoin(tenant_id="tenant", account_id="account"),
                snapshot,
            ]
        )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)
    with (
        Redis() as connection,
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
            PLUGIN_DAEMON_KEY="plugin-key",
            INNER_API_KEY_FOR_PLUGIN="inner-key",
            KNOWLEDGE_FS_ENABLED=True,
            KNOWLEDGE_FS_BASE_URL="http://kfs:8000",
        ),
        patch(
            "tasks.knowledge_fs_agent_investigation_tasks.capture_agent_knowledge_investigation_task.delay"
        ) as enqueue,
    ):
        redis = RedisClientWrapper()
        redis.initialize(connection)
        app.extensions["application_services"] = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.CLOUD,
            initialization_password="",
            redis=redis,
        )
        yield _Boundary(app.test_client(), payload, enqueue)


def test_queues_once_per_space_with_original_identity(boundary: _Boundary) -> None:
    response = boundary.client.post(PATH, json=boundary.payload, headers=HEADERS)

    assert response.status_code == 202
    assert response.get_json() == {"accepted": True}
    assert boundary.enqueue.call_count == 2
    assert {call.kwargs["control_space_id"] for call in boundary.enqueue.call_args_list} == {
        binding["control_space_id"] for binding in boundary.payload["bindings"]
    }
    assert all(
        call.kwargs["report"]["investigation_id"] == boundary.payload["investigation_id"]
        for call in boundary.enqueue.call_args_list
    )


def test_revoked_scope_cannot_enqueue_a_report(boundary: _Boundary) -> None:
    boundary.payload["attempts"][0]["control_space_id"] = str(uuid4())
    response = boundary.client.post(PATH, json=boundary.payload, headers=HEADERS)
    assert response.status_code == 403
    assert response.get_json()["code"] == "KNOWLEDGE_SCOPE_MISMATCH"
    boundary.enqueue.assert_not_called()


def test_broker_failure_is_not_acknowledged_as_accepted(boundary: _Boundary) -> None:
    boundary.enqueue.side_effect = OSError("broker offline")
    assert boundary.client.post(PATH, json=boundary.payload, headers=HEADERS).status_code == 500


def test_missing_inner_api_key_cannot_enqueue_a_report(boundary: _Boundary) -> None:
    assert boundary.client.post(PATH, json=boundary.payload).status_code == 404
    boundary.enqueue.assert_not_called()


def test_swagger_documents_report_and_queue_admission(boundary: _Boundary) -> None:
    with boundary.client.application.test_request_context():
        schema = Swagger(inner_api).as_dict()
    route = schema["paths"]["/agent/knowledge/investigations"]["post"]
    assert route["requestBody"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/KnowledgeInvestigationPayload"
    )
    assert route["responses"]["202"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/KnowledgeInvestigationAcceptedResponse"
    )
