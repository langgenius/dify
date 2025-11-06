"""
Human Input node implementation.
"""

import json
import logging
import uuid
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Optional, Union

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.graph_engine.entities.event import InNodeEvent
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.event import NodeEvent
from core.workflow.nodes.human_input.entities import (
    HumanInputNodeData,
    HumanInputRequired,
    WorkflowSuspended,
)
from extensions.ext_database import db
from services.human_input_form_service import HumanInputFormService

logger = logging.getLogger(__name__)


class HumanInputNode(BaseNode):
    """
    Human Input Node implementation.

    This node pauses workflow execution and waits for human input through
    configured delivery methods (webapp or email). The workflow resumes
    once the form is submitted.
    """

    _node_type: NodeType = NodeType.HUMAN_INPUT
    _node_data_cls = HumanInputNodeData
    node_data: HumanInputNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        """Initialize node data from configuration."""
        self.node_data = self._node_data_cls.model_validate(data)

    def _run(self) -> NodeRunResult | Generator[Union[NodeEvent, InNodeEvent], None, None]:
        """
        Execute the human input node.

        This method will:
        1. Generate a unique form ID
        2. Create form content with variable substitution
        3. Create form in database
        4. Send form via configured delivery methods
        5. Suspend workflow execution
        6. Wait for form submission to resume
        """
        try:
            # Generate unique form ID
            form_id = str(uuid.uuid4())

            # Create form content with variable substitution
            form_content = self._process_form_content()

            # Generate webapp token if webapp delivery is enabled
            web_app_form_token = None
            webapp_enabled = any(dm.enabled and dm.type.value == "webapp" for dm in self.node_data.delivery_methods)
            if webapp_enabled:
                web_app_form_token = str(uuid.uuid4()).replace("-", "")

            # Create form definition for database storage
            form_definition = {
                "node_id": self.node_id,
                "title": self.node_data.title,
                "inputs": [inp.model_dump() for inp in self.node_data.inputs],
                "user_actions": [action.model_dump() for action in self.node_data.user_actions],
                "timeout": self.node_data.timeout,
                "timeout_unit": self.node_data.timeout_unit.value,
                "delivery_methods": [dm.model_dump() for dm in self.node_data.delivery_methods],
            }

            # Create form in database
            service = HumanInputFormService(db.session())
            service.create_form(
                form_id=form_id,
                workflow_run_id=self.graph_runtime_state.workflow_run_id,
                tenant_id=self.graph_init_params.tenant_id,
                app_id=self.graph_init_params.app_id,
                form_definition=json.dumps(form_definition),
                rendered_content=form_content,
                web_app_token=web_app_form_token,
            )

            # Create human input required event
            human_input_event = HumanInputRequired(
                form_id=form_id,
                node_id=self.node_id,
                form_content=form_content,
                inputs=self.node_data.inputs,
                web_app_form_token=web_app_form_token,
            )

            # Create workflow suspended event
            suspended_event = WorkflowSuspended(suspended_at_node_ids=[self.node_id])

            logger.info(f"Human Input node {self.node_id} suspended workflow for form {form_id}")

            # Return suspension result
            # The workflow engine should handle the suspension and resume logic
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.RUNNING,  # Node is still running, waiting for input
                inputs={},
                outputs={},
                metadata={
                    "form_id": form_id,
                    "web_app_form_token": web_app_form_token,
                    "human_input_event": human_input_event.model_dump(),
                    "suspended_event": suspended_event.model_dump(),
                    "suspended": True,  # Flag to indicate this node caused suspension
                },
            )

        except Exception as e:
            logger.exception(f"Human Input node {self.node_id} failed to execute")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="HumanInputNodeError",
            )

    def _process_form_content(self) -> str:
        """
        Process form content by substituting variables.

        This method should:
        1. Parse the form_content markdown
        2. Substitute {{#node_name.var_name#}} with actual values
        3. Keep {{#$output.field_name#}} placeholders for form inputs
        """
        # TODO: Implement variable substitution logic
        # For now, return the raw form content
        # This should integrate with the existing variable template parser
        return self.node_data.form_content

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selectors referenced in form content and input placeholders.

        This method should parse:
        1. Variables referenced in form_content ({{#node_name.var_name#}})
        2. Variables referenced in input placeholders
        """
        # TODO: Implement variable extraction logic
        # This should parse the form_content and placeholder configurations
        # to extract all referenced variables
        return {}

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """Get default configuration for human input node."""
        return {
            "type": "human_input",
            "config": {
                "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                "form_content": "# Human Input\n\nPlease provide your input:\n\n{{#$output.input#}}",
                "inputs": [
                    {
                        "type": "text-input",
                        "output_variable_name": "input",
                        "placeholder": {"type": "constant", "value": "Enter your response here..."},
                    }
                ],
                "user_actions": [{"id": "submit", "title": "Submit", "button_style": "primary"}],
                "timeout": 24,
                "timeout_unit": "hour",
            },
        }

    @classmethod
    def version(cls) -> str:
        """Return the version of the human input node."""
        return "1"

    def _get_error_strategy(self) -> Optional[ErrorStrategy]:
        """Get the error strategy for this node."""
        return self.node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        """Get the retry configuration for this node."""
        return self.node_data.retry_config

    def _get_title(self) -> str:
        """Get the node title."""
        return self.node_data.title

    def _get_description(self) -> Optional[str]:
        """Get the node description."""
        return self.node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        """Get the default values dictionary for this node."""
        return self.node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        """Get the BaseNodeData object for this node."""
        return self.node_data

    def resume_from_human_input(self, form_submission_data: dict[str, Any]) -> NodeRunResult:
        """
        Resume node execution after human input form is submitted.

        Args:
            form_submission_data: Dict containing:
                - inputs: Dict of input field values
                - action: The user action taken

        Returns:
            NodeRunResult with the form inputs as outputs
        """
        try:
            inputs = form_submission_data.get("inputs", {})
            action = form_submission_data.get("action", "")

            # Create output dictionary with form inputs
            outputs = {}
            for input_field in self.node_data.inputs:
                field_name = input_field.output_variable_name
                if field_name in inputs:
                    outputs[field_name] = inputs[field_name]

            # Add the action to outputs
            outputs["_action"] = action

            logger.info(f"Human Input node {self.node_id} resumed with action {action}")

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                outputs=outputs,
                metadata={
                    "form_submitted": True,
                    "submitted_action": action,
                },
            )

        except Exception as e:
            logger.exception(f"Human Input node {self.node_id} failed to resume")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="HumanInputResumeError",
            )
