from unittest.mock import MagicMock, patch

import pytest

import tasks.trigger_processing_tasks as trigger_processing_tasks_module
from services.errors.app import QuotaExceededError
from tasks.trigger_processing_tasks import dispatch_triggered_workflow


class TestDispatchTriggeredWorkflow:
    """Unit tests covering branch behaviours of ``dispatch_triggered_workflow``.

    The covered branches are:
    - workflow missing for ``plugin_trigger.app_id`` → log + ``continue``
    - ``QuotaService.reserve`` raising ``QuotaExceededError`` →
      ``mark_tenant_triggers_rate_limited`` + early ``return``
    - ``trigger_workflow_async`` succeeds →
      ``quota_charge.commit()`` + ``dispatched_count`` increments
    """

    @pytest.fixture
    def subscription(self):
        sub = MagicMock()
        sub.id = "subscription-123"
        sub.tenant_id = "tenant-123"
        sub.provider_id = "langgenius/test_plugin/test_plugin"
        sub.endpoint_id = "endpoint-123"
        sub.credentials = {}
        sub.credential_type = "api_key"
        return sub

    @pytest.fixture
    def plugin_trigger(self):
        trigger = MagicMock()
        trigger.id = "plugin-trigger-123"
        trigger.app_id = "app-123"
        trigger.node_id = "node-123"
        return trigger

    @pytest.fixture
    def provider_controller(self):
        controller = MagicMock()
        controller.plugin_unique_identifier = "langgenius/test_plugin:0.0.1"
        controller.entity.identity.name = "Test Plugin"
        controller.entity.identity.icon = "icon.svg"
        controller.entity.identity.icon_dark = "icon_dark.svg"
        return controller

    @pytest.fixture
    def dispatch_mocks(self, subscription, plugin_trigger, provider_controller):
        """Patch all external dependencies reached by ``dispatch_triggered_workflow``.

        Defaults are configured so the code flow can reach the final async
        trigger block (line ~385); each test overrides specific handles
        (``get_workflows``, ``reserve``, ``create_end_user_batch``, ...) to
        drive the path it targets.
        """
        session_cm = MagicMock()
        session_cm.__enter__.return_value = MagicMock()
        session_cm.__exit__.return_value = False

        invoke_response = MagicMock()
        invoke_response.cancelled = False
        invoke_response.variables = {}

        quota_charge = MagicMock()

        with (
            patch.object(
                trigger_processing_tasks_module.TriggerHttpRequestCachingService,
                "get_request",
                return_value=MagicMock(),
            ),
            patch.object(
                trigger_processing_tasks_module.TriggerHttpRequestCachingService,
                "get_payload",
                return_value=MagicMock(),
            ),
            patch.object(
                trigger_processing_tasks_module.TriggerSubscriptionOperatorService,
                "get_subscriber_triggers",
                return_value=[plugin_trigger],
            ),
            patch.object(
                trigger_processing_tasks_module.TriggerManager,
                "get_trigger_provider",
                return_value=provider_controller,
            ),
            patch.object(
                trigger_processing_tasks_module.TriggerManager,
                "invoke_trigger_event",
                return_value=invoke_response,
            ) as invoke_trigger_event,
            patch.object(
                trigger_processing_tasks_module.TriggerEventNodeData,
                "model_validate",
                return_value=MagicMock(),
            ),
            patch.object(
                trigger_processing_tasks_module,
                "_get_latest_workflows_by_app_ids",
            ) as get_workflows,
            patch.object(
                trigger_processing_tasks_module.EndUserService,
                "create_end_user_batch",
                return_value={},
            ) as create_end_user_batch,
            patch.object(
                trigger_processing_tasks_module.session_factory,
                "create_session",
                return_value=session_cm,
            ),
            patch.object(
                trigger_processing_tasks_module.QuotaService,
                "reserve",
                return_value=quota_charge,
            ) as reserve,
            patch.object(
                trigger_processing_tasks_module.AppTriggerService,
                "mark_tenant_triggers_rate_limited",
            ) as mark_rate_limited,
            patch.object(
                trigger_processing_tasks_module.AsyncWorkflowService,
                "trigger_workflow_async",
            ) as trigger_workflow_async,
        ):
            yield {
                "get_workflows": get_workflows,
                "reserve": reserve,
                "quota_charge": quota_charge,
                "mark_rate_limited": mark_rate_limited,
                "invoke_trigger_event": invoke_trigger_event,
                "invoke_response": invoke_response,
                "create_end_user_batch": create_end_user_batch,
                "trigger_workflow_async": trigger_workflow_async,
            }

    def test_dispatch_skips_when_workflow_missing(self, subscription, dispatch_mocks):
        """Covers missing workflow → log + ``continue``."""
        dispatch_mocks["get_workflows"].return_value = {}

        dispatched = dispatch_triggered_workflow(
            user_id="user-123",
            subscription=subscription,
            event_name="test_event",
            request_id="request-123",
        )

        assert dispatched == 0
        dispatch_mocks["reserve"].assert_not_called()
        dispatch_mocks["invoke_trigger_event"].assert_not_called()
        dispatch_mocks["mark_rate_limited"].assert_not_called()

    def test_dispatch_marks_rate_limited_when_quota_exceeded(self, subscription, plugin_trigger, dispatch_mocks):
        """Covers QuotaExceededError → mark rate-limited + early return."""
        workflow_mock = MagicMock()
        workflow_mock.walk_nodes.return_value = iter(
            [(plugin_trigger.node_id, {"type": trigger_processing_tasks_module.TRIGGER_PLUGIN_NODE_TYPE})]
        )
        dispatch_mocks["get_workflows"].return_value = {plugin_trigger.app_id: workflow_mock}
        dispatch_mocks["reserve"].side_effect = QuotaExceededError(
            feature="trigger", tenant_id=subscription.tenant_id, required=1
        )

        dispatched = dispatch_triggered_workflow(
            user_id="user-123",
            subscription=subscription,
            event_name="test_event",
            request_id="request-123",
        )

        assert dispatched == 0
        dispatch_mocks["reserve"].assert_called_once()
        dispatch_mocks["mark_rate_limited"].assert_called_once_with(subscription.tenant_id)
        dispatch_mocks["invoke_trigger_event"].assert_not_called()

    def test_dispatch_commits_quota_and_counts_when_workflow_triggered(
        self, subscription, plugin_trigger, dispatch_mocks
    ):
        """Happy path: end user exists and async trigger succeeds."""
        workflow_mock = MagicMock()
        workflow_mock.id = "workflow-123"
        workflow_mock.walk_nodes.return_value = iter(
            [(plugin_trigger.node_id, {"type": trigger_processing_tasks_module.TRIGGER_PLUGIN_NODE_TYPE})]
        )
        dispatch_mocks["get_workflows"].return_value = {plugin_trigger.app_id: workflow_mock}

        end_user_mock = MagicMock()
        dispatch_mocks["create_end_user_batch"].return_value = {plugin_trigger.app_id: end_user_mock}

        dispatched = dispatch_triggered_workflow(
            user_id="user-123",
            subscription=subscription,
            event_name="test_event",
            request_id="request-123",
        )

        assert dispatched == 1
        dispatch_mocks["trigger_workflow_async"].assert_called_once()
        _, kwargs = dispatch_mocks["trigger_workflow_async"].call_args
        assert kwargs["user"] is end_user_mock
        dispatch_mocks["quota_charge"].commit.assert_called_once()
        dispatch_mocks["quota_charge"].refund.assert_not_called()
        dispatch_mocks["mark_rate_limited"].assert_not_called()
