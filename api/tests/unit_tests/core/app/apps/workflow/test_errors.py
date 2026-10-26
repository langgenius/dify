from core.app.apps.workflow.errors import WorkflowPausedInBlockingModeError


class TestWorkflowErrors:
    def test_workflow_paused_in_blocking_mode_error_attributes(self) -> None:
        err = WorkflowPausedInBlockingModeError()
        assert err.error_code == "workflow_paused_in_blocking_mode"
        assert err.code == 400
        assert err.description is not None
        assert "blocking response mode" in err.description
