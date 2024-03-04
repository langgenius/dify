from abc import abstractmethod

from models.workflow import WorkflowNodeExecution, WorkflowRun


class BaseWorkflowCallback:
    @abstractmethod
    def on_workflow_run_started(self, workflow_run: WorkflowRun) -> None:
        """
        Workflow run started
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_run_finished(self, workflow_run: WorkflowRun) -> None:
        """
        Workflow run finished
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_node_execute_started(self, workflow_node_execution: WorkflowNodeExecution) -> None:
        """
        Workflow node execute started
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_node_execute_finished(self, workflow_node_execution: WorkflowNodeExecution) -> None:
        """
        Workflow node execute finished
        """
        raise NotImplementedError
