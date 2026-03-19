from unittest.mock import MagicMock, patch

from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY
from services.workflow.entities import WebhookTriggerData
from tasks import async_workflow_tasks


def test_build_generator_args_sets_skip_flag_for_webhook():
    trigger_data = WebhookTriggerData(
        app_id="app",
        tenant_id="tenant",
        workflow_id="workflow",
        root_node_id="node",
        inputs={"webhook_data": {"body": {"foo": "bar"}}},
    )

    args = async_workflow_tasks._build_generator_args(trigger_data)

    assert args[SKIP_PREPARE_USER_INPUTS_KEY] is True
    assert args["inputs"]["webhook_data"]["body"]["foo"] == "bar"


def test_execute_workflow_common_uses_trigger_call_depth():
    trigger_data = WebhookTriggerData(
        app_id="app",
        tenant_id="tenant",
        workflow_id="workflow",
        root_node_id="node",
        inputs={"webhook_data": {"body": {}}},
        call_depth=3,
    )
    trigger_log = MagicMock(
        id="log-id",
        app_id="app",
        workflow_id="workflow",
        trigger_data=trigger_data.model_dump_json(),
    )
    trigger_log_repo = MagicMock()
    trigger_log_repo.get_by_id.return_value = trigger_log
    session = MagicMock()
    session.scalar.side_effect = [MagicMock(), MagicMock()]
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    workflow_generator = MagicMock()

    with (
        patch.object(async_workflow_tasks.session_factory, "create_session", return_value=session_context),
        patch.object(async_workflow_tasks, "SQLAlchemyWorkflowTriggerLogRepository", return_value=trigger_log_repo),
        patch.object(async_workflow_tasks, "_get_user", return_value=MagicMock()),
        patch.object(async_workflow_tasks, "WorkflowAppGenerator", return_value=workflow_generator),
    ):
        async_workflow_tasks._execute_workflow_common(
            async_workflow_tasks.WorkflowTaskData(workflow_trigger_log_id="log-id"),
            MagicMock(),
            MagicMock(),
        )

    assert workflow_generator.generate.call_args.kwargs["call_depth"] == 3
