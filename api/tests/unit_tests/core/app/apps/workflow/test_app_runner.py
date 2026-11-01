from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models.model import AppMode
from models.workflow import Workflow, WorkflowKind
from models.workflow import WorkflowType as ModelWorkflowType


def _runner() -> WorkflowAppRunner:
    """Build a runner over real Dify objects so prepare() runs its production path."""
    app_generate_entity = WorkflowAppGenerateEntity(
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
        ),
        inputs={"question": "hello"},
        files=[],
        user_id="user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id="execution-id",
        task_id="task-id",
        stream=True,
        call_depth=1,
    )
    workflow = Workflow(
        tenant_id="tenant",
        app_id="app",
        id="workflow",
        type=ModelWorkflowType.WORKFLOW,
        version="v1",
        graph=json.dumps({"nodes": [], "edges": []}),
        kind=WorkflowKind.SNIPPET,
    )
    workflow.environment_variables = []
    with patch("core.app.apps.base_app_queue_manager.redis_client"):
        queue_manager = WorkflowAppQueueManager(
            task_id="task-id",
            user_id="user",
            invoke_from=InvokeFrom.SERVICE_API,
            app_mode="workflow",
        )
    return WorkflowAppRunner(
        application_generate_entity=app_generate_entity,
        queue_manager=queue_manager,
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=workflow,
        system_user_id="system-user",
    )


def _system_variables_built_by_prepare() -> MagicMock:
    """Run prepare() with the Redis-backed collaborators replaced and return the build_system_variables mock."""
    runner = _runner()
    with (
        patch("core.app.apps.workflow.app_runner.RedisChannel"),
        patch("core.app.apps.workflow.app_runner.redis_client"),
        patch("core.app.apps.workflow.app_runner.WorkflowEntry"),
        patch("core.app.apps.workflow.app_runner.build_system_variables", return_value=[]) as system_variables,
        patch("core.app.apps.workflow.app_runner.build_bootstrap_variables", return_value=[]),
        patch("core.app.apps.workflow.app_runner.add_variables_to_pool"),
        patch("core.app.apps.workflow.app_runner.get_default_root_node_id", return_value="root-node"),
        patch("core.app.apps.workflow.app_runner.get_compatible_start_aliases", return_value=()),
        patch("core.app.apps.workflow.app_runner.add_node_inputs_to_pool"),
        patch.object(runner, "_init_graph"),
    ):
        runner.prepare()
    return system_variables


def test_prepare_should_read_the_system_timestamp_from_the_epoch(monkeypatch: pytest.MonkeyPatch) -> None:
    """sys.timestamp is a Unix timestamp, so it must not follow the host timezone."""
    if not hasattr(time, "tzset"):
        pytest.skip("tzset is only available on POSIX platforms")
    recorded_at = datetime(2024, 5, 1, tzinfo=UTC)
    monkeypatch.setattr("core.app.apps.workflow.app_runner.naive_utc_now", lambda: recorded_at.replace(tzinfo=None))
    previous_tz = os.environ.get("TZ")
    monkeypatch.setenv("TZ", "Asia/Shanghai")
    time.tzset()
    try:
        system_variables = _system_variables_built_by_prepare()
    finally:
        if previous_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = previous_tz
        time.tzset()

    assert system_variables.call_args.kwargs["timestamp"] == int(recorded_at.timestamp())
