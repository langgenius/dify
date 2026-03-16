import json
import logging
from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from dify_graph.entities.graph_config import NodeConfigDict
from dify_graph.entities.pause_reason import HumanInputRequired
from dify_graph.enums import BuiltinNodeTypes, NodeExecutionType, WorkflowNodeExecutionStatus
from dify_graph.node_events import (
    HumanInputFormFilledEvent,
    HumanInputFormTimeoutEvent,
    NodeRunResult,
    PauseRequestedEvent,
)
from dify_graph.node_events.base import NodeEventBase
from dify_graph.node_events.node import StreamCompletedEvent
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.runtime import HumanInputFormStateProtocol, HumanInputNodeRuntimeProtocol
from dify_graph.workflow_type_encoder import WorkflowRuntimeTypeConverter

from .entities import HumanInputNodeData
from .enums import HumanInputFormStatus, PlaceholderType

if TYPE_CHECKING:
    from dify_graph.entities.graph_init_params import GraphInitParams
    from dify_graph.runtime.graph_runtime_state import GraphRuntimeState


_SELECTED_BRANCH_KEY = "selected_branch"


logger = logging.getLogger(__name__)


class HumanInputNode(Node[HumanInputNodeData]):
    node_type = BuiltinNodeTypes.HUMAN_INPUT
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
    _OUTPUT_FIELD_ACTION_ID = "__action_id"
    _OUTPUT_FIELD_RENDERED_CONTENT = "__rendered_content"
    _TIMEOUT_HANDLE = _TIMEOUT_ACTION_ID = "__timeout"

    def __init__(
        self,
        id: str,
        config: NodeConfigDict,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        runtime: HumanInputNodeRuntimeProtocol | None = None,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        if runtime is None:
            raise ValueError("runtime is required")
        self._runtime = runtime

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

    def _form_to_pause_event(self, form_entity: HumanInputFormStateProtocol):
        required_event = self._human_input_required_event(form_entity)
        pause_requested_event = PauseRequestedEvent(reason=required_event)
        return pause_requested_event

    def resolve_default_values(self) -> Mapping[str, Any]:
        variable_pool = self.graph_runtime_state.variable_pool
        resolved_defaults: dict[str, Any] = {}
        for input in self._node_data.inputs:
            if (default_value := input.default) is None:
                continue
            if default_value.type == PlaceholderType.CONSTANT:
                continue
            resolved_value = variable_pool.get(default_value.selector)
            if resolved_value is None:
                # TODO: How should we handle this?
                continue
            resolved_defaults[input.output_variable_name] = (
                WorkflowRuntimeTypeConverter().value_to_json_encodable_recursive(resolved_value.value)
            )

        return resolved_defaults

    def _human_input_required_event(self, form_entity: HumanInputFormStateProtocol) -> HumanInputRequired:
        node_data = self._node_data
        resolved_default_values = self.resolve_default_values()
        return HumanInputRequired(
            form_id=form_entity.id,
            form_content=form_entity.rendered_content,
            inputs=node_data.inputs,
            actions=node_data.user_actions,
            node_id=self.id,
            node_title=node_data.title,
            resolved_default_values=resolved_default_values,
        )

    def _run(self) -> Generator[NodeEventBase, None, None]:
        """
        Execute the human input node.

        This method will:
        1. Generate a unique form ID
        2. Create form content with variable substitution
        3. Persist the form through the configured repository
        4. Send form via configured delivery methods
        5. Suspend workflow execution
        6. Wait for form submission to resume
        """
        form = self._runtime.get_form(node_id=self.id)
        if form is None:
            form_entity = self._runtime.create_form(
                node_id=self.id,
                node_data=self._node_data,
                rendered_content=self.render_form_content_before_submission(),
                resolved_default_values=self.resolve_default_values(),
            )

            logger.info(
                "Human Input node suspended workflow for form. node_id=%s, form_id=%s",
                self.id,
                form_entity.id,
            )
            yield self._form_to_pause_event(form_entity)
            return

        if form.status in {
            HumanInputFormStatus.TIMEOUT,
            HumanInputFormStatus.EXPIRED,
        } or form.expiration_time <= datetime.now(UTC).replace(tzinfo=None):
            yield HumanInputFormTimeoutEvent(
                node_title=self._node_data.title,
                expiration_time=form.expiration_time,
            )
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    outputs={self._OUTPUT_FIELD_ACTION_ID: ""},
                    edge_source_handle=self._TIMEOUT_HANDLE,
                )
            )
            return

        if not form.submitted:
            yield self._form_to_pause_event(form)
            return

        selected_action_id = form.selected_action_id
        if selected_action_id is None:
            raise AssertionError(f"selected_action_id should not be None when form submitted, form_id={form.id}")
        submitted_data = form.submitted_data or {}
        outputs: dict[str, Any] = dict(submitted_data)
        outputs[self._OUTPUT_FIELD_ACTION_ID] = selected_action_id
        rendered_content = self.render_form_content_with_outputs(
            form.rendered_content,
            outputs,
            self._node_data.outputs_field_names(),
        )
        outputs[self._OUTPUT_FIELD_RENDERED_CONTENT] = rendered_content

        action_text = self._node_data.find_action_text(selected_action_id)

        yield HumanInputFormFilledEvent(
            node_title=self._node_data.title,
            rendered_content=rendered_content,
            action_id=selected_action_id,
            action_text=action_text,
        )

        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs=outputs,
                edge_source_handle=selected_action_id,
            )
        )

    def render_form_content_before_submission(self) -> str:
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

    @staticmethod
    def render_form_content_with_outputs(
        form_content: str,
        outputs: Mapping[str, Any],
        field_names: Sequence[str],
    ) -> str:
        """
        Replace {{#$output.xxx#}} placeholders with submitted values.
        """
        rendered_content = form_content
        for field_name in field_names:
            placeholder = "{{#$output." + field_name + "#}}"
            value = outputs.get(field_name)
            if value is None:
                replacement = ""
            elif isinstance(value, (dict, list)):
                replacement = json.dumps(value, ensure_ascii=False)
            else:
                replacement = str(value)
            rendered_content = rendered_content.replace(placeholder, replacement)
        return rendered_content

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: HumanInputNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selectors referenced in form content and input default values.

        This method should parse:
        1. Variables referenced in form_content ({{#node_name.var_name#}})
        2. Variables referenced in input default values
        """
        return node_data.extract_variable_selector_to_variable_mapping(node_id)
