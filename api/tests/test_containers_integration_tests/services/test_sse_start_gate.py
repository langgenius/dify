import json
import queue
import threading
import time
import uuid
from typing import Any
from unittest.mock import patch

from flask.testing import FlaskClient

from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.task_entities import StreamEvent
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.model import ApiToken, App, AppMode
from models.workflow import Workflow


def _create_tenant_and_owner() -> tuple[Tenant, Account, TenantAccountJoin]:
    tenant = Tenant(
        name="Test Tenant",
        status="normal",
    )
    tenant.id = str(uuid.uuid4())
    account = Account(
        email=f"owner-{uuid.uuid4()}@example.com",
        name="Owner",
        interface_language="en-US",
        status="active",
    )
    account.id = str(uuid.uuid4())
    tenant_join = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.OWNER,
        current=True,
    )
    return tenant, account, tenant_join


def _create_workflow_app(tenant: Tenant, account: Account) -> tuple[App, Workflow]:
    app = App(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        name="Test Workflow App",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type="emoji",
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        created_by=account.id,
        updated_by=account.id,
    )
    workflow = Workflow(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        version="v1",
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps({"features": []}),
        created_by=account.id,
        updated_by=account.id,
        environment_variables=[],
        conversation_variables=[],
    )
    app.workflow_id = workflow.id
    return app, workflow


def _create_api_token(app: App) -> ApiToken:
    return ApiToken(
        app_id=app.id,
        tenant_id=app.tenant_id,
        type="app",
        token=f"app-token-{uuid.uuid4()}",
    )


def _collect_sse_events(response, max_events: int = 2, timeout: float = 3.0) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    buffer = ""
    chunks = queue.Queue()

    def _reader() -> None:
        try:
            for chunk in response.response:
                chunks.put(chunk)
        finally:
            chunks.put(None)

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()

    deadline = time.time() + timeout
    try:
        while time.time() < deadline and len(events) < max_events:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            try:
                chunk = chunks.get(timeout=min(0.1, remaining))
            except queue.Empty:
                continue
            if chunk is None:
                break
            if not chunk:
                continue
            buffer += chunk.decode("utf-8")
            while "\n\n" in buffer:
                block, buffer = buffer.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[len("data: ") :]
                    events.append(json.loads(payload))
                    if len(events) >= max_events:
                        break
    finally:
        response.close()

    return events


class TestSSEStartGateIntegration:
    def test_workflow_streaming_sse_starts_after_subscribe(
        self,
        db_session_with_containers,
        test_client_with_containers: FlaskClient,
    ):
        tenant, account, tenant_join = _create_tenant_and_owner()
        app, workflow = _create_workflow_app(tenant, account)
        api_token = _create_api_token(app)

        db_session_with_containers.add_all([tenant, account, tenant_join, app, workflow, api_token])
        db_session_with_containers.commit()

        def _fake_delay(payload_json: str):
            payload = json.loads(payload_json)
            workflow_run_id = payload["workflow_run_id"]
            app_mode = AppMode.value_of(payload["app_mode"])
            topic = MessageBasedAppGenerator.get_response_topic(app_mode, workflow_run_id)
            events = [
                {
                    "event": StreamEvent.WORKFLOW_STARTED.value,
                    "workflow_run_id": workflow_run_id,
                    "created_at": int(time.time()),
                },
                {
                    "event": StreamEvent.WORKFLOW_FINISHED.value,
                    "workflow_run_id": workflow_run_id,
                    "created_at": int(time.time()),
                },
            ]
            for event in events:
                topic.publish(json.dumps(event).encode())

        payload = {
            "inputs": {},
            "response_mode": "streaming",
            "user": "test-end-user",
        }

        with (
            patch("services.app_generate_service.SSE_TASK_START_FALLBACK_MS", 5_000),
            patch("services.app_generate_service.workflow_base_app_execution_task.delay", side_effect=_fake_delay),
        ):
            response = test_client_with_containers.post(
                "/v1/workflows/run",
                json=payload,
                headers={"Authorization": f"Bearer {api_token.token}"},
                buffered=False,
            )

        assert response.status_code == 200

        events = _collect_sse_events(response)
        assert len(events) == 2
        assert events[0]["event"] == StreamEvent.WORKFLOW_STARTED.value
        assert events[1]["event"] == StreamEvent.WORKFLOW_FINISHED.value
