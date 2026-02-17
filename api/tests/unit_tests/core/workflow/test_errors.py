from types import SimpleNamespace

from core.workflow.errors import WorkflowNodeRunFailedError


class TestWorkflowErrors:
    def test_workflow_node_run_failed_error_message(self):
        node = SimpleNamespace(title="Test Node")

        error = WorkflowNodeRunFailedError(node=node, err_msg="boom")

        assert str(error) == "Node Test Node run failed: boom"

    def test_workflow_node_run_failed_error_properties(self):
        node = SimpleNamespace(title="Any Node")

        error = WorkflowNodeRunFailedError(node=node, err_msg="failure")

        assert error.node is node
        assert error.error == "failure"

    def test_workflow_node_run_failed_error_handles_empty_message(self):
        node = SimpleNamespace(title="Empty Node")

        error = WorkflowNodeRunFailedError(node=node, err_msg="")

        assert str(error) == "Node Empty Node run failed: "
