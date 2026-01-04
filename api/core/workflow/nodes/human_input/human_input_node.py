import json
import logging
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.repositories.human_input_reposotiry import HumanInputFormRepositoryImpl
from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import HumanInputFormFilledEvent, NodeRunResult, PauseRequestedEvent
from core.workflow.node_events.base import NodeEventBase
from core.workflow.nodes.base.node import Node
from core.workflow.repositories.human_input_form_repository import (
    FormCreateParams,
    HumanInputFormEntity,
    HumanInputFormRepository,
)
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now

from .entities import HumanInputNodeData
from .enums import HumanInputFormStatus, PlaceholderType

if TYPE_CHECKING:
    from core.workflow.entities.graph_init_params import GraphInitParams
    from core.workflow.runtime.graph_runtime_state import GraphRuntimeState


_SELECTED_BRANCH_KEY = "selected_branch"


logger = logging.getLogger(__name__)


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
    _form_repository: HumanInputFormRepository

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        form_repository: HumanInputFormRepository | None = None,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        if form_repository is None:
            form_repository = HumanInputFormRepositoryImpl(
                session_factory=db.engine,
                tenant_id=self.tenant_id,
            )
        self._form_repository = form_repository

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

    @property
    def _workflow_execution_id(self) -> str:
        workflow_exec_id = self.graph_runtime_state.variable_pool.system_variables.workflow_execution_id
        assert workflow_exec_id is not None
        return workflow_exec_id

    def _form_to_pause_event(self, form_entity: HumanInputFormEntity):
        required_event = self._human_input_required_event(form_entity)
        pause_requested_event = PauseRequestedEvent(reason=required_event)
        return pause_requested_event

    def _resolve_inputs(self) -> Mapping[str, Any]:
        variable_pool = self.graph_runtime_state.variable_pool
        resolved_inputs = {}
        for input in self._node_data.inputs:
            if (placeholder := input.placeholder) is None:
                continue
            if placeholder.type == PlaceholderType.CONSTANT:
                continue
            placeholder_value = variable_pool.get(placeholder.selector)
            if placeholder_value is None:
                # TODO: How should we handle this?
                continue
            resolved_inputs[input.output_variable_name] = (
                WorkflowRuntimeTypeConverter().value_to_json_encodable_recursive(placeholder_value.value)
            )

        return resolved_inputs

    def _human_input_required_event(self, form_entity: HumanInputFormEntity) -> HumanInputRequired:
        node_data = self._node_data
        resolved_placeholder_values = self._resolve_inputs()
        return HumanInputRequired(
            form_id=form_entity.id,
            form_content=form_entity.rendered_content,
            inputs=node_data.inputs,
            actions=node_data.user_actions,
            node_id=self.id,
            node_title=node_data.title,
            web_app_form_token=form_entity.web_app_token,
            resolved_placeholder_values=resolved_placeholder_values,
        )

    def _create_form(self) -> Generator[NodeEventBase, None, None] | NodeRunResult:
        try:
            params = FormCreateParams(
                workflow_execution_id=self._workflow_execution_id,
                node_id=self.id,
                form_config=self._node_data,
                rendered_content=self._render_form_content(),
                resolved_placeholder_values=self._resolve_inputs(),
            )
            form_entity = self._form_repository.create_form(params)
            # Create human input required event

            logger.info(
                "Human Input node suspended workflow for form. workflow_run_id=%s, node_id=%s, form_id=%s",
                self.graph_runtime_state.variable_pool.system_variables.workflow_execution_id,
                self.id,
                form_entity.id,
            )
            yield self._form_to_pause_event(form_entity)
        except Exception as e:
            logger.exception("Human Input node failed to execute, node_id=%s", self.id)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="HumanInputNodeError",
            )

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
        repo = self._form_repository
        form = repo.get_form(self._workflow_execution_id, self.id)
        if form is None:
            return self._create_form()

        if form.submitted:
            selected_action_id = form.selected_action_id
            if selected_action_id is None:
                raise AssertionError(f"selected_action_id should not be None when form submitted, form_id={form.id}")
            submitted_data = form.submitted_data or {}
            outputs: dict[str, Any] = dict(submitted_data)
            outputs["__action_id"] = selected_action_id
            rendered_content = self._render_form_content_with_outputs(
                form.rendered_content,
                outputs,
                self._node_data.outputs_field_names(),
            )
            outputs["__rendered_content"] = rendered_content

            action_text = self._node_data.find_action_text(selected_action_id)

            yield HumanInputFormFilledEvent(
                rendered_content=rendered_content,
                action_id=selected_action_id,
                action_text=action_text,
            )

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs=outputs,
                edge_source_handle=selected_action_id,
            )

        if form.status == HumanInputFormStatus.TIMEOUT or form.expiration_time <= naive_utc_now():
            outputs: dict[str, Any] = {
                "__rendered_content": self._render_form_content_with_outputs(
                    form.rendered_content,
                    {},
                    self._node_data.outputs_field_names(),
                )
            }
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs=outputs,
                edge_source_handle="__timeout",
            )

        return self._pause_with_form(form)

    def _pause_with_form(self, form_entity: HumanInputFormEntity) -> Generator[NodeEventBase, None, None]:
        yield self._form_to_pause_event(form_entity)

    def _render_form_content(self) -> str:
        """
        Process form content by substituting variables.

        This method should:
        1. Parse the form_content markdown
        2. Substitute {{#node_name.var_name#}} with actual values
        3. Keep {{#$outputs.field_name#}} placeholders for form inputs
        """
        rendered_form_content = self.graph_runtime_state.variable_pool.convert_template(
            self._node_data.form_content,
        )
        return rendered_form_content.markdown

    @staticmethod
    def _render_form_content_with_outputs(
        form_content: str,
        outputs: Mapping[str, Any],
        field_names: Sequence[str],
    ) -> str:
        """
        Replace {{#$outputs.xxx#}} placeholders with submitted values.
        """
        rendered_content = form_content
        for field_name in field_names:
            placeholder = "{{#$outputs." + field_name + "#}}"
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
