from core.app.task_pipeline.exc import RecordNotFoundError, WorkflowRunNotFoundError


class TestTaskPipelineExceptions:
    def test_record_not_found_error_message(self):
        err = RecordNotFoundError("Message", "msg-1")
        assert str(err) == "Message with id msg-1 not found"

    def test_workflow_run_not_found_error_message(self):
        err = WorkflowRunNotFoundError("run-1")
        assert str(err) == "WorkflowRun with id run-1 not found"
