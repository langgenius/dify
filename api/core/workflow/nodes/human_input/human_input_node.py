import dataclasses
import logging
from collections.abc import Generator, Mapping, Sequence
from typing import Any

from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, PauseRequestedEvent
from core.workflow.node_events.base import NodeEventBase
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.repositories.human_input_form_repository import FormCreateParams, HumanInputFormRepository

from .entities import HumanInputNodeData

_SELECTED_BRANCH_KEY = "selected_branch"

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class _FormSubmissionResult:
    action_id: str


class HumanInputNode(Node[HumanInputNodeData]):
    node_type = NodeType.HUMAN_INPUT
    execution_type = NodeExecutionType.BRANCH

    _BRANCH_SELECTION_KEYS: tuple[str, ...] = (
        "edge_source_handle",
        "edgeSourceHandle",
        "source_handle",
        _SELECTED_BRANCH_KEY,
        "selectedBranch",
        "branch",
        "branch_id",
        "branchId",
        "handle",
    )

    _node_data: HumanInputNodeData

    @classmethod
    def version(cls) -> str:
        return "1"

    def _resolve_branch_selection(self) -> str | None:
        """Determine the branch handle selected by human input if available."""

        variable_pool = self.graph_runtime_state.variable_pool

        for key in self._BRANCH_SELECTION_KEYS:
            handle = self._extract_branch_handle(variable_pool.get((self.id, key)))
            if handle:
                return handle

        default_values = self.node_data.default_value_dict
        for key in self._BRANCH_SELECTION_KEYS:
            handle = self._normalize_branch_value(default_values.get(key))
            if handle:
                return handle

        return None

    @staticmethod
    def _extract_branch_handle(segment: Any) -> str | None:
        if segment is None:
            return None

        candidate = getattr(segment, "to_object", None)
        raw_value = candidate() if callable(candidate) else getattr(segment, "value", None)
        if raw_value is None:
            return None

        return HumanInputNode._normalize_branch_value(raw_value)

    @staticmethod
    def _normalize_branch_value(value: Any) -> str | None:
        if value is None:
            return None

        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None

        if isinstance(value, Mapping):
            for key in ("handle", "edge_source_handle", "edgeSourceHandle", "branch", "id", "value"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate:
                    return candidate

        return None

    def _create_form_repository(self) -> HumanInputFormRepository:
        pass

    @staticmethod
    def _pause_generator(event: PauseRequestedEvent) -> Generator[NodeEventBase, None, None]:
        yield event

    @property
    def _workflow_execution_id(self) -> str:
        workflow_exec_id = self.graph_runtime_state.variable_pool.system_variables.workflow_execution_id
        assert workflow_exec_id is not None
        return workflow_exec_id

    def _run(self) -> NodeRunResult | Generator[NodeEventBase, None, None]:
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
        repo = self._create_form_repository()
        submission_result = repo.get_form_submission(self._workflow_execution_id, self.app_id)
        if submission_result:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    "action_id": submission_result.selected_action_id,
                },
                edge_source_handle=submission_result.selected_action_id,
            )
        try:
            repo = self._create_form_repository()
            params = FormCreateParams(
                workflow_execution_id=self._workflow_execution_id,
                node_id=self.id,
                form_config=self._node_data,
                rendered_content=self._render_form_content(),
            )
            result = repo.create_form(params)
            # Create human input required event

            required_event = HumanInputRequired(
                form_id=result.id,
                form_content=self._node_data.form_content,
                inputs=self._node_data.inputs,
                web_app_form_token=result.web_app_token,
            )
            pause_requested_event = PauseRequestedEvent(reason=required_event)

            # Create workflow suspended event

            logger.info(
                "Human Input node suspended workflow for form. workflow_run_id=%s, node_id=%s, form_id=%s",
                self.graph_runtime_state.variable_pool.system_variables.workflow_execution_id,
                self.id,
                result.id,
            )
        except Exception as e:
            logger.exception("Human Input node failed to execute, node_id=%s", self.id)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="HumanInputNodeError",
            )
        return self._pause_generator(pause_requested_event)

    def _render_form_content(self) -> str:
        """
        Process form content by substituting variables.

        This method should:
        1. Parse the form_content markdown
        2. Substitute {{#node_name.var_name#}} with actual values
        3. Keep {{#$output.field_name#}} placeholders for form inputs
        """
        rendered_form_content = self.graph_runtime_state.variable_pool.convert_template(
            self._node_data.form_content,
        )
        return rendered_form_content.markdown

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
        validated_node_data = HumanInputNodeData.model_validate(node_data)
        return validated_node_data.extract_variable_selector_to_variable_mapping(node_id)
