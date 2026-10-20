"""Exercise workflow statistics through console admission and PostgreSQL."""

from datetime import datetime
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowRun, WorkflowType
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


def _create_workflow_run(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
    created_by: str,
    created_at: datetime,
    total_tokens: int,
    triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.APP_RUN,
) -> None:
    session.add(
        WorkflowRun(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW,
            triggered_from=triggered_from,
            version="1",
            graph="{}",
            inputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            total_tokens=total_tokens,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=created_by,
            created_at=created_at,
        )
    )


@pytest.mark.parametrize(
    ("endpoint", "metric", "expected"),
    [
        ("daily-conversations", "runs", 3),
        ("daily-terminals", "terminal_count", 2),
        ("token-costs", "token_count", 60),
        ("average-app-interactions", "interactions", 1.5),
    ],
)
def test_workflow_statistics_scope_and_local_date_range(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    endpoint: str,
    metric: str,
    expected: int | float,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    account.timezone = "Asia/Shanghai"
    db_session_with_containers.commit()
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    other_app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    other_account, other_tenant = create_console_account_and_tenant(db_session_with_containers)

    for created_by, created_at, tokens in (
        (account.id, datetime(2026, 9, 30, 16), 10),
        (account.id, datetime(2026, 10, 1, 8), 20),
        (other_account.id, datetime(2026, 10, 1, 15, 59), 30),
    ):
        _create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant.id,
            app_id=app.id,
            created_by=created_by,
            created_at=created_at,
            total_tokens=tokens,
        )

    # Each decoy is independently excluded by the repository's scope or range.
    for tenant_id, app_id, triggered_from, created_at in (
        (tenant.id, other_app.id, WorkflowRunTriggeredFrom.APP_RUN, datetime(2026, 10, 1, 8)),
        (other_tenant.id, app.id, WorkflowRunTriggeredFrom.APP_RUN, datetime(2026, 10, 1, 8)),
        (tenant.id, app.id, WorkflowRunTriggeredFrom.DEBUGGING, datetime(2026, 10, 1, 8)),
        (tenant.id, app.id, WorkflowRunTriggeredFrom.APP_RUN, datetime(2026, 9, 30, 15, 59)),
        (tenant.id, app.id, WorkflowRunTriggeredFrom.APP_RUN, datetime(2026, 10, 1, 16)),
    ):
        _create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            created_by=account.id,
            created_at=created_at,
            total_tokens=100,
            triggered_from=triggered_from,
        )
    db_session_with_containers.commit()

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflow/statistics/{endpoint}",
        query_string={"start": "2026-10-01 00:00", "end": "2026-10-02 00:00"},
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"data": [{"date": "2026-10-01", metric: expected}]}
