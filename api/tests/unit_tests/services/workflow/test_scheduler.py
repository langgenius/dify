import pytest

from services.workflow.entities import WorkflowScheduleCFSPlanEntity
from services.workflow.scheduler import CFSPlanScheduler, SchedulerCommand


class TestSchedulerCommand:
    def test_enum_values(self):
        assert SchedulerCommand.RESOURCE_LIMIT_REACHED == "resource_limit_reached"
        assert SchedulerCommand.NONE == "none"

    def test_enum_is_str(self):
        for member in SchedulerCommand:
            assert isinstance(member, str)


class TestCFSPlanScheduler:
    def test_stores_plan(self):
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.Nop,
            granularity=-1,
        )

        class ConcretePlanScheduler(CFSPlanScheduler):
            def can_schedule(self):
                return SchedulerCommand.NONE

        scheduler = ConcretePlanScheduler(plan)

        assert scheduler.plan is plan
        assert scheduler.plan.schedule_strategy == WorkflowScheduleCFSPlanEntity.Strategy.Nop
        assert scheduler.plan.granularity == -1

    def test_cannot_instantiate_abstract(self):
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice,
            granularity=10,
        )
        with pytest.raises(TypeError):
            CFSPlanScheduler(plan)

    def test_concrete_subclass_can_schedule(self):
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice,
            granularity=5,
        )

        class TimedScheduler(CFSPlanScheduler):
            def can_schedule(self):
                if self.plan.granularity > 0:
                    return SchedulerCommand.NONE
                return SchedulerCommand.RESOURCE_LIMIT_REACHED

        scheduler = TimedScheduler(plan)
        assert scheduler.can_schedule() == SchedulerCommand.NONE

    def test_concrete_subclass_resource_limit(self):
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice,
            granularity=-1,
        )

        class TimedScheduler(CFSPlanScheduler):
            def can_schedule(self):
                if self.plan.granularity > 0:
                    return SchedulerCommand.NONE
                return SchedulerCommand.RESOURCE_LIMIT_REACHED

        scheduler = TimedScheduler(plan)
        assert scheduler.can_schedule() == SchedulerCommand.RESOURCE_LIMIT_REACHED


class TestWorkflowScheduleCFSPlanEntity:
    def test_strategy_values(self):
        assert WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice == "time-slice"
        assert WorkflowScheduleCFSPlanEntity.Strategy.Nop == "nop"

    def test_default_granularity(self):
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.Nop,
        )
        assert plan.granularity == -1

    def test_explicit_granularity(self):
        plan = WorkflowScheduleCFSPlanEntity(
            schedule_strategy=WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice,
            granularity=100,
        )
        assert plan.granularity == 100
