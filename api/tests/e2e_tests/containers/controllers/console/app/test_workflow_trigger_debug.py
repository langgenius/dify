"""Trigger debug routes use real Console admission and Redis event registration."""

import json
from http import HTTPStatus

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from models.model import AppMode
from models.workflow import Workflow
from services.trigger.debug_events import build_webhook_pool_key
from tests.e2e_tests.containers.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)
from tests.helpers.unit.config_override import config_overrides_context


@pytest.mark.parametrize("entrypoint", ["full", "node", "all"])
def test_trigger_debug_route_registers_authenticated_listener(
    db_session_with_containers: Session, test_client_with_containers: FlaskClient, entrypoint: str
) -> None:
    with config_overrides_context(RBAC_ENABLED=False, LOGIN_DISABLED=False):
        account, tenant = create_console_account_and_tenant(db_session_with_containers)
        app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
        workflow = Workflow.new(
            tenant_id=tenant.id,
            app_id=app.id,
            type="workflow",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps({"nodes": [{"id": "webhook", "data": {"type": "trigger-webhook", "title": "Webhook"}}]}),
            features="{}",
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        db_session_with_containers.add(workflow)
        db_session_with_containers.commit()

        prefix = f"/console/api/apps/{app.id}/workflows/draft"
        paths = {
            "full": f"{prefix}/trigger/run",
            "node": f"{prefix}/nodes/webhook/trigger/run",
            "all": f"{prefix}/trigger/run-all",
        }
        payload = {"node_ids": ["webhook"]} if entrypoint == "all" else {"node_id": "webhook"}
        pool = build_webhook_pool_key(tenant_id=tenant.id, app_id=app.id, node_id="webhook")
        try:
            unauthorized = test_client_with_containers.post(paths[entrypoint], json=payload)
            assert unauthorized.status_code == HTTPStatus.UNAUTHORIZED

            headers = authenticate_console_client(test_client_with_containers, account)
            response = test_client_with_containers.post(paths[entrypoint], json=payload, headers=headers)

            assert response.status_code == HTTPStatus.OK
            assert response.get_json() == {"status": "waiting", "retry_in": 2000}
            assert redis_client.eval("return redis.call('SCARD', KEYS[1])", 1, pool) == 1
        finally:
            redis_client.eval("return redis.call('DEL', KEYS[1])", 1, pool)
