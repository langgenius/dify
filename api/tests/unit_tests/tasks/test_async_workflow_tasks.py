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
