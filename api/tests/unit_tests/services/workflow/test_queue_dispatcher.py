from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest

from enums import CloudPlan, DeploymentEdition
from services.workflow.queue_dispatcher import (
    BaseQueueDispatcher,
    ProfessionalQueueDispatcher,
    QueueDispatcherManager,
    QueuePriority,
    SandboxQueueDispatcher,
    TeamQueueDispatcher,
)


class TestQueuePriority:
    def test_priority_values(self) -> None:
        assert QueuePriority.PROFESSIONAL == "workflow_professional"
        assert QueuePriority.TEAM == "workflow_team"
        assert QueuePriority.SANDBOX == "workflow_sandbox"


class TestDispatchers:
    def test_professional_dispatcher(self) -> None:
        d = ProfessionalQueueDispatcher()
        assert d.get_queue_name() == QueuePriority.PROFESSIONAL
        assert d.get_priority() == 100

    def test_team_dispatcher(self) -> None:
        d = TeamQueueDispatcher()
        assert d.get_queue_name() == QueuePriority.TEAM
        assert d.get_priority() == 50

    def test_sandbox_dispatcher(self) -> None:
        d = SandboxQueueDispatcher()
        assert d.get_queue_name() == QueuePriority.SANDBOX
        assert d.get_priority() == 10


class TestQueueDispatcherManager:
    @pytest.fixture(autouse=True)
    def _cloud_edition(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    @pytest.mark.parametrize(
        ("plan", "expected"),
        [
            (CloudPlan.PROFESSIONAL, ProfessionalQueueDispatcher),
            (CloudPlan.TEAM, TeamQueueDispatcher),
            (CloudPlan.SANDBOX, SandboxQueueDispatcher),
        ],
    )
    @patch("services.workflow.queue_dispatcher.FeatureService.get_workspace_plan")
    def test_cloud_edition_routes_by_plan(
        self, mock_get_plan: MagicMock, plan: CloudPlan, expected: type[BaseQueueDispatcher]
    ) -> None:
        mock_get_plan.return_value = plan

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, expected)
        mock_get_plan.assert_called_once_with("tenant-1")

    @pytest.mark.parametrize("error", [Exception("billing unavailable"), ValueError("'enterprise' is not a CloudPlan")])
    @patch("services.workflow.queue_dispatcher.FeatureService.get_workspace_plan")
    def test_cloud_edition_plan_failure_defaults_to_sandbox(self, mock_get_plan: MagicMock, error: Exception) -> None:
        mock_get_plan.side_effect = error

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, SandboxQueueDispatcher)

    def test_non_cloud_edition_defaults_to_team(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

        dispatcher = QueueDispatcherManager.get_dispatcher("tenant-1")

        assert isinstance(dispatcher, TeamQueueDispatcher)
