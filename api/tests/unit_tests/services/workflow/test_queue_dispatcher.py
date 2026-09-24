from unittest.mock import patch

import pytest

from enums import DeploymentEdition
from services.workflow.queue_dispatcher import (
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


class TestQueueDispatcherManager:
    @pytest.fixture(autouse=True)
    def _cloud_edition(self, config_overrides) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    @patch("services.workflow.queue_dispatcher.BillingService")
    def test_cloud_edition_professional_plan(self, mock_billing):
        mock_billing.get_info.return_value = {"subscription": {"plan": "professional"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, ProfessionalQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    def test_cloud_edition_team_plan(self, mock_billing):
        mock_billing.get_info.return_value = {"subscription": {"plan": "team"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, TeamQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    def test_cloud_edition_sandbox_plan(self, mock_billing):
        mock_billing.get_info.return_value = {"subscription": {"plan": "sandbox"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    def test_cloud_edition_unknown_plan_defaults_to_sandbox(self, mock_billing):
        mock_billing.get_info.return_value = {"subscription": {"plan": "enterprise"}}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    def test_cloud_edition_billing_failure_defaults_to_sandbox(self, mock_billing):
        mock_billing.get_info.side_effect = Exception("billing unavailable")

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    def test_non_cloud_edition_defaults_to_team(self, config_overrides):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, TeamQueueDispatcher)

    @patch("services.workflow.queue_dispatcher.BillingService")
    def test_missing_subscription_key_defaults_to_sandbox(self, mock_billing):
        mock_billing.get_info.return_value = {}

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)
