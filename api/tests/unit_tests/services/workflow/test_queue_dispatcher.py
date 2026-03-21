from unittest.mock import patch

import pytest

from services.workflow.queue_dispatcher import (
    BaseQueueDispatcher,
    ProfessionalQueueDispatcher,
    QueueDispatcherManager,
    QueuePriority,
    SandboxQueueDispatcher,
    TeamQueueDispatcher,
)


class TestQueuePriority:
    def test_priority_values(self):
        assert QueuePriority.PROFESSIONAL == "workflow_professional"
        assert QueuePriority.TEAM == "workflow_team"
        assert QueuePriority.SANDBOX == "workflow_sandbox"


class TestDispatchers:
    def test_professional_dispatcher(self):
        d = ProfessionalQueueDispatcher()
        assert d.get_queue_name() == QueuePriority.PROFESSIONAL
        assert d.get_priority() == 100

    def test_team_dispatcher(self):
        d = TeamQueueDispatcher()
        assert d.get_queue_name() == QueuePriority.TEAM
        assert d.get_priority() == 50

    def test_sandbox_dispatcher(self):
        d = SandboxQueueDispatcher()
        assert d.get_queue_name() == QueuePriority.SANDBOX
        assert d.get_priority() == 10

    def test_base_dispatcher_is_abstract(self):
        with pytest.raises(TypeError):
            BaseQueueDispatcher()


class TestQueueDispatcherManager:
    @patch("services.workflow.queue_dispatcher.BillingService")
    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_billing_enabled_professional_plan(self, mock_config, mock_billing):
        mock_config.BILLING_ENABLED = True
        mock_billing.get_info.return_value = {"subscription": {"plan": "professional"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, ProfessionalQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_billing_enabled_team_plan(self, mock_config, mock_billing):
        mock_config.BILLING_ENABLED = True
        mock_billing.get_info.return_value = {"subscription": {"plan": "team"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, TeamQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_billing_enabled_sandbox_plan(self, mock_config, mock_billing):
        mock_config.BILLING_ENABLED = True
        mock_billing.get_info.return_value = {"subscription": {"plan": "sandbox"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_billing_enabled_unknown_plan_defaults_to_sandbox(self, mock_config, mock_billing):
        mock_config.BILLING_ENABLED = True
        mock_billing.get_info.return_value = {"subscription": {"plan": "enterprise"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_billing_enabled_service_failure_defaults_to_sandbox(self, mock_config, mock_billing):
        mock_config.BILLING_ENABLED = True
        mock_billing.get_info.side_effect = Exception("billing unavailable")

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_billing_disabled_defaults_to_team(self, mock_config):
        mock_config.BILLING_ENABLED = False

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, TeamQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    @patch("services.workflow.queue_dispatcher.dify_config")
    def test_missing_subscription_key_defaults_to_sandbox(self, mock_config, mock_billing):
        mock_config.BILLING_ENABLED = True
        mock_billing.get_info.return_value = {}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)
