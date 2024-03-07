from abc import ABC, abstractmethod

from models.workflow import WorkflowNodeExecution, WorkflowRun


class BaseWorkflowCallback(ABC):
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

    @abstractmethod
    def on_node_text_chunk(self, node_id: str, text: str) -> None:
        """
        Publish text chunk
        """
        raise NotImplementedError

