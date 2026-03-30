from unittest.mock import Mock, patch

from graphon.graph_engine.entities.commands import CommandType, GraphEngineCommand

from core.app.layers.timeslice_layer import TimeSliceLayer
from services.workflow.entities import WorkflowScheduleCFSPlanEntity
from services.workflow.scheduler import SchedulerCommand


class TestTimeSliceLayer:
    def test_init_starts_scheduler_when_not_running(self):
        scheduler = Mock()
        scheduler.running = False

        with patch("core.app.layers.timeslice_layer.TimeSliceLayer.scheduler", scheduler):
            _ = TimeSliceLayer(cfs_plan_scheduler=Mock(plan=Mock()))

        scheduler.start.assert_called_once()

    def test_on_graph_start_adds_job_for_time_slice(self):
        scheduler = Mock()
        scheduler.running = True
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice,
            granularity=3,
        )
        cfs_plan_scheduler = Mock(plan=plan)

        with (
            patch("core.app.layers.timeslice_layer.TimeSliceLayer.scheduler", scheduler),
            patch("core.app.layers.timeslice_layer.uuid.uuid4") as mock_uuid,
        ):
            mock_uuid.return_value.hex = "job-1"
            layer = TimeSliceLayer(cfs_plan_scheduler=cfs_plan_scheduler)
            layer.on_graph_start()

        assert layer.schedule_id == "job-1"
        scheduler.add_job.assert_called_once()

    def test_on_graph_end_removes_job(self):
        scheduler = Mock()
        scheduler.running = True
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice,
            granularity=3,
        )
        cfs_plan_scheduler = Mock(plan=plan)

        with patch("core.app.layers.timeslice_layer.TimeSliceLayer.scheduler", scheduler):
            layer = TimeSliceLayer(cfs_plan_scheduler=cfs_plan_scheduler)
            layer.schedule_id = "job-1"
            layer.on_graph_end(None)

        scheduler.remove_job.assert_called_once_with("job-1")

    def test_checker_job_removes_when_stopped(self):
        scheduler = Mock()
        scheduler.running = True
        cfs_plan_scheduler = Mock(plan=Mock())

        with patch("core.app.layers.timeslice_layer.TimeSliceLayer.scheduler", scheduler):
            layer = TimeSliceLayer(cfs_plan_scheduler=cfs_plan_scheduler)
            layer.stopped = True
            layer._checker_job("job-1")

        scheduler.remove_job.assert_called_once_with("job-1")

    def test_checker_job_handles_resource_limit_without_command_channel(self):
        scheduler = Mock()
        scheduler.running = True
        cfs_plan_scheduler = Mock(plan=Mock())
        cfs_plan_scheduler.can_schedule.return_value = SchedulerCommand.RESOURCE_LIMIT_REACHED

        with (
            patch("core.app.layers.timeslice_layer.TimeSliceLayer.scheduler", scheduler),
            patch("core.app.layers.timeslice_layer.logger") as mock_logger,
        ):
            layer = TimeSliceLayer(cfs_plan_scheduler=cfs_plan_scheduler)
            layer._checker_job("job-1")

        scheduler.remove_job.assert_called_once_with("job-1")
        mock_logger.exception.assert_called_once()

    def test_checker_job_sends_pause_command(self):
        scheduler = Mock()
        scheduler.running = True
        cfs_plan_scheduler = Mock(plan=Mock())
        cfs_plan_scheduler.can_schedule.return_value = SchedulerCommand.RESOURCE_LIMIT_REACHED

        with patch("core.app.layers.timeslice_layer.TimeSliceLayer.scheduler", scheduler):
            layer = TimeSliceLayer(cfs_plan_scheduler=cfs_plan_scheduler)
            layer.command_channel = Mock()
            layer._checker_job("job-1")

        scheduler.remove_job.assert_called_once_with("job-1")
        layer.command_channel.send_command.assert_called_once()
        sent_command = layer.command_channel.send_command.call_args[0][0]
        assert isinstance(sent_command, GraphEngineCommand)
        assert sent_command.command_type == CommandType.PAUSE
