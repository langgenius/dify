"""Create Workflow CSV export tasks through Console admission and the Redis adapter."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app import workflow_app_log
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from graphon.enums import WorkflowExecutionStatus
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from models import Account, Tenant, TenantAccountJoin
from models.model import AppMode
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from services.retention.log_export_task_cache import RedisLogExportTasks
from services.retention.workflow_run.log_export_service import (
    WorkflowLogExportFilters,
    WorkflowLogExportService,
    WorkflowLogExportTask,
)
from services.workflow_app_log_query_service import WorkflowAppLogQueryService
from tests.helpers.unit.model_factories import make_account, make_app


@dataclass(frozen=True)
class _ExportClient:
    client: FlaskClient
    headers: dict[str, str]
    path: str
    tenant_id: str
    app_id: str
    account_id: str
    redis: Mock
    paid: Mock


@pytest.fixture
def export_client(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[_ExportClient]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=False,
        RBAC_ENABLED=False,
        SECRET_KEY="workflow-export-http-tests-key-at-least-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
    )
    tenant = Tenant(name="Workflow workspace")
    account = make_account(account_id=str(uuid4()))
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                account,
                tenant,
                target,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )

    app = Flask(__name__)
    app.config.update(
        TESTING=True, SECRET_KEY="workflow-export-test-session", SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url)
    )
    db.init_app(app)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)

    @login_manager.user_loader
    def load_account(account_id: str) -> Account | None:
        with sqlite_session_factory() as session:
            loaded = session.get(Account, account_id)
            if loaded is not None:
                loaded.set_tenant_id_with_session(tenant.id, session=session)
            return loaded

    redis = Mock(spec=RedisClientWrapper)
    paid = Mock(return_value=True)
    monkeypatch.setattr(workflow_app_log, "is_cloud_edition_billing_paid_plan", paid)
    app.extensions["application_services"] = SimpleNamespace(
        workflow_app_logs=WorkflowAppLogQueryService(
            logs=WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)
        ),
        workflow_log_exports=WorkflowLogExportService(
            save_task=RedisLogExportTasks(
                redis=redis, task_type=WorkflowLogExportTask, key_prefix="workflow_log_export"
            ).save,
        ),
    )
    ExternalApi(app).add_resource(workflow_app_log.WorkflowLogExportApi, "/apps/<uuid:app_id>/workflow-log-exports")

    client = app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = account.id
        session["_fresh"] = True
    token = generate_csrf_token(account.id)
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    yield _ExportClient(
        client,
        {HEADER_NAME_CSRF_TOKEN: token},
        f"/apps/{target.id}/workflow-log-exports",
        tenant.id,
        target.id,
        account.id,
        redis,
        paid,
    )
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_create_workflow_log_export_saves_the_admitted_scope_and_filters(export_client: _ExportClient) -> None:
    end_user_id = str(uuid4())
    response = export_client.client.post(
        export_client.path,
        headers=export_client.headers,
        json={"status": "failed", "created_at__after": "2026-01-02T12:00:00+08:00", "end_user_ids": [end_user_id]},
    )

    assert response.status_code == 202
    task_id = response.json["task_id"]
    assert str(UUID(task_id)) == task_id
    assert response.json == {"task_id": task_id, "status": "pending"}
    key, ttl, raw = export_client.redis.setex.call_args_list[0].args
    task = WorkflowLogExportTask.model_validate_json(raw)
    assert key == f"workflow_log_export:{export_client.tenant_id}:{export_client.app_id}:{task_id}"
    assert (task.task_id, task.tenant_id, task.app_id, task.requested_by) == (
        task_id,
        export_client.tenant_id,
        export_client.app_id,
        export_client.account_id,
    )
    assert task.filters == WorkflowLogExportFilters(
        status=WorkflowExecutionStatus.FAILED, created_at_after=datetime(2026, 1, 2, 4), end_user_ids=(end_user_id,)
    )
    assert task.expires_at - task.created_at == timedelta(days=1)
    assert 0 < ttl <= 86400
    export_client.redis.setex.assert_called_with(
        f"workflow_log_export_latest:{export_client.tenant_id}:{export_client.app_id}:{export_client.account_id}",
        ttl,
        task_id,
    )


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [({"page": 1}, 422), ({"created_at__after": "2026-01-02", "created_at__before": "2026-01-01"}, 400)],
)
def test_create_workflow_log_export_rejects_invalid_filters(
    export_client: _ExportClient, payload: object, expected_status: int
) -> None:
    response = export_client.client.post(export_client.path, headers=export_client.headers, json=payload)

    assert response.status_code == expected_status
    export_client.redis.setex.assert_not_called()


def test_create_workflow_log_export_requires_cloud_entitlement(export_client: _ExportClient) -> None:
    export_client.paid.return_value = False

    response = export_client.client.post(export_client.path, headers=export_client.headers, json={})

    assert response.status_code == 403
    export_client.redis.setex.assert_not_called()
