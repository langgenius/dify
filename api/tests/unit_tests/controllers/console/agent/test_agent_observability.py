"""Exercise Agent observability through Console admission and real SQLite queries."""

import json
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from sqlite3 import Connection
from threading import Thread
from typing import override
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine, event

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account
from models.agent import Agent, AgentScope, AgentSource
from models.enums import ConversationFromSource, MessageStatus
from models.model import App, AppMode
from services.enterprise.base import EnterpriseRequest
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_conversation, make_message
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)


def test_logs_and_messages_respect_agent_scope_and_account_timezone(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    other_id, other_app = harness.create_agent(tenant_id=str(uuid4()))
    conversation_id, message_id = str(uuid4()), str(uuid4())
    with harness.sessions.begin() as session:
        account = session.get(Account, harness.account_id)
        assert account is not None
        account.timezone = "Asia/Shanghai"
        session.add(
            make_conversation(
                conversation_id=conversation_id,
                app_id=app_id,
                mode=AppMode.AGENT,
                name="Example",
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=harness.account_id,
                invoke_from=InvokeFrom.EXPLORE,
            )
        )
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=conversation_id,
                inputs={},
                query="hello",
                message={},
                answer="world",
                status=MessageStatus.NORMAL,
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=harness.account_id,
                invoke_from=InvokeFrom.EXPLORE,
                message_tokens=3,
                answer_tokens=4,
                created_at=datetime(2026, 1, 1, 4, tzinfo=UTC),
            )
        )
    base = f"/console/api/agent/{agent_id}"
    query = "?sources=webapp&start=2026-01-01%2011%3A00&end=2026-01-01%2013%3A00"
    response = harness.client.get(f"{base}/logs{query}", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["total"] == 1
    assert [item["id"] for item in body["data"]] == [conversation_id]
    messages = harness.client.get(f"{base}/logs/{conversation_id}/messages{query}", headers=harness.headers)
    assert messages.status_code == HTTPStatus.OK
    assert [item["id"] for item in messages.get_json()["data"]] == [message_id]
    assert messages.get_json()["data"][0]["total_tokens"] == 7
    outside = harness.client.get(f"{base}/logs?sources=webapp&end=2026-01-01%2011%3A00", headers=harness.headers)
    assert outside.status_code == HTTPStatus.OK
    assert outside.get_json()["total"] == 0
    foreign = harness.client.get(f"/console/api/agent/{other_id}/logs?sources=webapp", headers=harness.headers)
    assert foreign.status_code == HTTPStatus.NOT_FOUND
    assert other_app != app_id


def test_sources_and_invalid_queries_use_real_http(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    base = f"/console/api/agent/{agent_id}"
    sources = harness.client.get(f"{base}/log-sources", headers=harness.headers)
    assert sources.status_code == HTTPStatus.OK
    assert sources.get_json()["data"][0]["app_id"] == app_id
    invalid_source = harness.client.get(f"{base}/statistics/summary?source=unknown", headers=harness.headers)
    assert invalid_source.status_code == HTTPStatus.BAD_REQUEST
    assert "Unsupported source" in invalid_source.get_json()["message"]
    invalid_date = harness.client.get(f"{base}/logs?sources=webapp&start=not-a-date", headers=harness.headers)
    assert invalid_date.status_code == HTTPStatus.BAD_REQUEST
    assert "Invalid start time" in invalid_date.get_json()["message"]
    invalid_sort = harness.client.get(f"{base}/logs?sort_by=invalid", headers=harness.headers)
    assert invalid_sort.status_code == HTTPStatus.BAD_REQUEST
    assert invalid_sort.get_json()["code"] == "invalid_param"
    assert harness.client.get(f"{base}/log-sources").status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.parametrize("has_backing_app", [True, False])
def test_workflow_only_agent_resolves_its_backing_app(harness: Harness, has_backing_app: bool) -> None:
    """Resolve an existing hidden App or persist one and reuse it on later requests."""
    agent_id, backing_app_id = harness.create_agent()
    workflow_app_id = str(uuid4())
    with harness.sessions.begin() as session:
        session.add(
            App(
                id=workflow_app_id,
                tenant_id=harness.tenant_id,
                name="Workflow",
                mode=AppMode.WORKFLOW,
                created_by=harness.account_id,
                maintainer=harness.account_id,
                enable_site=False,
                enable_api=False,
            )
        )
        agent = session.get(Agent, agent_id)
        assert agent is not None
        agent.scope = AgentScope.WORKFLOW_ONLY
        agent.source = AgentSource.WORKFLOW
        agent.app_id = workflow_app_id
        agent.backing_app_id = backing_app_id if has_backing_app else None
        agent.workflow_id = str(uuid4())
        agent.workflow_node_id = "node-1"
    url = f"/console/api/agent/{agent_id}/log-sources"
    response = harness.client.get(url, headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    resolved_app_id = response.get_json()["data"][0]["app_id"]
    assert (resolved_app_id == backing_app_id) is has_backing_app
    assert resolved_app_id != workflow_app_id
    with harness.sessions() as session:
        agent = session.get(Agent, agent_id)
        app = session.get(App, resolved_app_id)
        assert agent is not None
        assert agent.backing_app_id == resolved_app_id
        assert app is not None
        assert app.tenant_id == harness.tenant_id
        assert app.mode == AppMode.AGENT
        assert app.enable_api is False
        assert app.enable_site is False
    repeated = harness.client.get(url, headers=harness.headers)
    assert repeated.status_code == HTTPStatus.OK
    assert repeated.get_json()["data"][0]["app_id"] == resolved_app_id


def test_rbac_denies_each_observability_route_before_query(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    with harness.sessions.begin() as session:
        agent = session.get(Agent, agent_id)
        assert agent is not None
        agent.created_by = str(uuid4())
    scenes: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            assert self.path == "/rbac/check-access"
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert payload["tenant_id"] == harness.tenant_id
            assert payload["account_id"] == harness.account_id
            assert payload["resource_id"] == agent_id
            scenes.append(payload["scene"])
            data = b'{"allowed": false}'
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    previous_url = EnterpriseRequest.rbac_base_url
    EnterpriseRequest.rbac_base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        with config_overrides_context(RBAC_ENABLED=True):
            base = f"/console/api/agent/{agent_id}"
            for path in ("logs", f"logs/{uuid4()}/messages", "log-sources", "statistics/summary"):
                assert harness.client.get(f"{base}/{path}", headers=harness.headers).status_code == HTTPStatus.FORBIDDEN
        assert scenes == ["agent_log_manage", "agent_log_manage", "agent_log_manage", "agent_monitor"]
    finally:
        EnterpriseRequest.rbac_base_url = previous_url
        server.shutdown()
        thread.join()
        server.server_close()


def test_webapp_statistics_use_account_timezone(harness: Harness, sqlite_engine: Engine) -> None:
    """Run the MySQL-shaped aggregate in SQLite with a timezone conversion function."""
    agent_id, app_id = harness.create_agent()
    conversation_id = str(uuid4())
    with harness.sessions.begin() as session:
        account = session.get(Account, harness.account_id)
        assert account is not None
        account.timezone = "Asia/Shanghai"
        session.add(
            make_conversation(
                conversation_id=conversation_id,
                app_id=app_id,
                mode=AppMode.AGENT,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )
        session.add(
            make_message(
                message_id=str(uuid4()),
                app_id=app_id,
                conversation_id=conversation_id,
                inputs={},
                query="hello",
                message={},
                answer="world",
                from_source=ConversationFromSource.CONSOLE,
                message_tokens=3,
                answer_tokens=4,
                created_at=datetime(2026, 1, 1, 20, tzinfo=UTC),
            )
        )

    def convert_tz(value: str, source: str, target: str) -> str:
        return (
            datetime.fromisoformat(value)
            .replace(tzinfo=ZoneInfo(source))
            .astimezone(ZoneInfo(target))
            .replace(tzinfo=None)
            .isoformat()
        )

    def install_function(connection: Connection, _record: object, _proxy: object) -> None:
        connection.create_function("CONVERT_TZ", 3, convert_tz)

    event.listen(sqlite_engine, "checkout", install_function)
    try:
        with config_overrides_context(DB_TYPE="mysql"):
            response = harness.client.get(
                f"/console/api/agent/{agent_id}/statistics/summary?source=webapp", headers=harness.headers
            )
        assert response.status_code == HTTPStatus.OK
        body = response.get_json()
        assert body["summary"]["total_messages"] == 1
        assert body["charts"]["daily_messages"] == [{"date": "2026-01-02", "message_count": 1}]
    finally:
        event.remove(sqlite_engine, "checkout", install_function)
