import json
from collections.abc import Mapping
from unittest.mock import MagicMock, patch

import pytest

import tasks.trigger_processing_tasks as trigger_processing_tasks_module
from core.plugin.entities.plugin_daemon import CredentialType
from graphon.enums import WorkflowType
from models.enums import EndUserType
from models.model import EndUser
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from models.workflow import Workflow
from services.errors.app import QuotaExceededError
from tasks.trigger_processing_tasks import dispatch_triggered_workflow


def _workflow(*, app_id: str = "app-123") -> Workflow:
    workflow = Workflow.new(
        tenant_id="tenant-123",
        app_id=app_id,
        type=WorkflowType.WORKFLOW.value,
        version="published",
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "id": "node-123",
                        "data": {"type": trigger_processing_tasks_module.TRIGGER_PLUGIN_NODE_TYPE},
                    }
                ],
                "edges": [],
            }
        ),
        features="{}",
        created_by="user-123",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = "workflow-123"
    return workflow


def _end_user() -> EndUser:
    return EndUser(
        id="end-user-123",
        tenant_id="tenant-123",
        app_id="app-123",
        type=EndUserType.TRIGGER,
        session_id="trigger-session",
    )


class _EndUserServiceStub:
    def __init__(self) -> None:
        self.result: Mapping[str, EndUser] = {}
        self.calls: list[tuple[EndUserType, str, list[str], str]] = []

    def create_end_user_batch(
        self,
        type: EndUserType,
        tenant_id: str,
        app_ids: list[str],
        user_id: str,
    ) -> Mapping[str, EndUser]:
        self.calls.append((type, tenant_id, app_ids, user_id))
        return self.result


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
        subscription = TriggerSubscription(
            tenant_id="tenant-123",
            user_id="user-123",
            name="Test Subscription",
            endpoint_id="endpoint-123",
            provider_id="langgenius/test_plugin/test_plugin",
            parameters={},
            properties={},
            credentials={},
            credential_type=CredentialType.API_KEY,
        )
        subscription.id = "subscription-123"
        return subscription

    @pytest.fixture
    def plugin_trigger(self):
        trigger = WorkflowPluginTrigger(
            app_id="app-123",
            node_id="node-123",
            tenant_id="tenant-123",
            provider_id="langgenius/test_plugin/test_plugin",
            event_name="test_event",
            subscription_id="subscription-123",
        )
        trigger.id = "plugin-trigger-123"
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
        (``get_workflows``, ``reserve``, ``end_users``, ...) to
        drive the path it targets.
        """
        invoke_response = MagicMock()
        invoke_response.cancelled = False
        invoke_response.variables = {}

        quota_charge = MagicMock()
        end_users = _EndUserServiceStub()

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
                "_get_published_workflows_by_app_ids",
            ) as get_workflows,
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
                "end_users": end_users,
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
            end_users=dispatch_mocks["end_users"],
        )

        assert dispatched == 0
        dispatch_mocks["reserve"].assert_not_called()
        dispatch_mocks["invoke_trigger_event"].assert_not_called()
        dispatch_mocks["mark_rate_limited"].assert_not_called()

    def test_dispatch_marks_rate_limited_when_quota_exceeded(self, subscription, plugin_trigger, dispatch_mocks):
        """Covers QuotaExceededError → mark rate-limited + early return."""
        workflow = _workflow()
        dispatch_mocks["get_workflows"].return_value = {plugin_trigger.app_id: workflow}
        dispatch_mocks["reserve"].side_effect = QuotaExceededError(
            feature="trigger", tenant_id=subscription.tenant_id, required=1
        )

        dispatched = dispatch_triggered_workflow(
            user_id="user-123",
            subscription=subscription,
            event_name="test_event",
            request_id="request-123",
            end_users=dispatch_mocks["end_users"],
        )

        assert dispatched == 0
        dispatch_mocks["reserve"].assert_called_once()
        dispatch_mocks["mark_rate_limited"].assert_called_once_with(subscription.tenant_id)
        dispatch_mocks["invoke_trigger_event"].assert_not_called()

    def test_dispatch_commits_quota_and_counts_when_workflow_triggered(
        self, subscription, plugin_trigger, dispatch_mocks
    ):
        """Happy path: end user exists and async trigger succeeds."""
        workflow = _workflow()
        dispatch_mocks["get_workflows"].return_value = {plugin_trigger.app_id: workflow}

        end_user = _end_user()
        dispatch_mocks["end_users"].result = {plugin_trigger.app_id: end_user}

        dispatched = dispatch_triggered_workflow(
            user_id="user-123",
            subscription=subscription,
            event_name="test_event",
            request_id="request-123",
            end_users=dispatch_mocks["end_users"],
        )

        assert dispatched == 1
        dispatch_mocks["trigger_workflow_async"].assert_called_once()
        _, kwargs = dispatch_mocks["trigger_workflow_async"].call_args
        assert kwargs["user"] is end_user
        dispatch_mocks["quota_charge"].commit.assert_called_once()
        dispatch_mocks["quota_charge"].refund.assert_not_called()
        dispatch_mocks["mark_rate_limited"].assert_not_called()
