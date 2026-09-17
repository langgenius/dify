"""Dify-owned Human Input v2 node; services are supplied through its runtime port.

Only the generic graphon node/event contracts are used. Dify form semantics do
not pass through HITLCallback. Keep v1 registrations and published runs intact.
"""

from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import assert_never, override

from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
)
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from graphon.entities.graph_init_params import GraphInitParams
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, NodeExecutionType, WorkflowNodeExecutionStatus
from graphon.graph_events import GraphNodeEventBase
from graphon.node_events import NodeEventBase, NodeRunResult, StreamCompletedEvent
from graphon.node_events.node import HumanInputFormFilledEvent, HumanInputFormTimeoutEvent, PauseRequestedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.runtime.graph_runtime_state import GraphRuntimeState
from graphon.variables.segments import ArrayFileSegment, Segment, StringSegment

from .entities import HUMAN_INPUT_V2_VERSION, DynamicEmail, HumanInputNodeData
from .runtime import HumanInputDeliveryError, HumanInputRuntime


class HumanInputNode(Node[HumanInputNodeData]):
    node_type = BuiltinNodeTypes.HUMAN_INPUT
    execution_type = NodeExecutionType.BRANCH

    def __init__(
        self,
        node_id: str,
        data: HumanInputNodeData,
        *,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        human_input_runtime: HumanInputRuntime,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._human_input_runtime = human_input_runtime

    @classmethod
    @override
    def version(cls) -> str:
        return HUMAN_INPUT_V2_VERSION

    @override
    def _run(self) -> Generator[NodeEventBase | GraphNodeEventBase, None, None]:
        """Consume persisted form outcomes; only completion events select edges."""
        try:
            prepared = self._human_input_runtime.prepare_form(
                node_execution_id=self.execution_id,
                node_data=self.node_data,
                variable_pool=self.graph_runtime_state.variable_pool,
            )
        except HumanInputDeliveryError as error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(error),
                    error_type=type(error).__name__,
                )
            )
            return

        form = prepared.form
        resolved = form.resolved_form
        match form.status:
            case HumanInputFormStatus.WAITING:
                # Graphon's pause union is closed. Presentation and access tokens
                # belong to Dify's output boundary, not to a reason subtype.
                yield PauseRequestedEvent(
                    reason=HitlRequired(
                        session_id=form.id,
                        node_id=self.id,
                        node_title=resolved.title,
                    )
                )
            case HumanInputFormStatus.SUBMITTED:
                submission = form.submission
                assert submission is not None, "Submitted form must contain its accepted submission"
                action = next(action for action in resolved.actions if action.id == submission.selected_action_id)
                inputs = submission.normalized_submission_data
                content = _render_filled_content(resolved, inputs)
                yield HumanInputFormFilledEvent(
                    node_title=resolved.title,
                    action_id=action.id,
                    action_text=action.title,
                    submitted_data=inputs,
                    rendered_content=content,
                )
                outputs = dict(inputs)
                outputs.update(_special_outputs(action.id, action.title, content))
                yield StreamCompletedEvent(
                    node_run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        inputs=inputs,
                        outputs=outputs,
                        edge_source_handle=action.id,
                    )
                )
            case HumanInputFormStatus.TIMEOUT:
                yield HumanInputFormTimeoutEvent(node_title=resolved.title, expiration_time=form.expiration_time)
                yield StreamCompletedEvent(
                    node_run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        outputs=_special_outputs("", "", resolved.legacy_form_content),
                        edge_source_handle="__timeout",
                    )
                )
            case HumanInputFormStatus.EXPIRED:
                # A node failure can take an error branch. Global expiration must
                # stop the graph itself, without dispatching a completion event.
                self.graph_runtime_state.graph_execution.abort(f"Human input form globally expired: {form.id}")
            case _:
                assert_never(form.status)

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, object],
        node_id: str,
        node_data: HumanInputNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """Expose all authoring dependencies to single-node debug execution.

        Include Form Content, input defaults/select options, Dynamic Email,
        and Message template subject/body selectors. Output slots and Request
        URL are not upstream variables. Preserve complete selectors, including
        nested paths. Recipient resolution and rendering still belong to the
        runtime; extracting dependencies must not invoke either operation.
        """
        selectors: list[Sequence[str]] = []
        for template in (node_data.form_content, node_data.message_template.subject, node_data.message_template.body):
            selectors.extend(
                item.value_selector for item in VariableTemplateParser(template).extract_variable_selectors()
            )
        for form_input in node_data.inputs:
            selectors.extend(form_input.extract_variable_selectors())
        for recipient in node_data.recipients_spec:
            if isinstance(recipient, DynamicEmail):
                selectors.append(recipient.selector)
        return {f"{node_id}.#{'.'.join(selector)}#": tuple(selector) for selector in selectors}


def _special_outputs(action_id: str, action_value: str, rendered_content: str) -> dict[str, Segment]:
    return {
        "__action_id": StringSegment(value=action_id),
        "__action_value": StringSegment(value=action_value),
        "__rendered_content": StringSegment(value=rendered_content),
    }


def _render_filled_content(form: ResolvedForm, inputs: Mapping[str, Segment]) -> str:
    # Render source-ordered parts once: submitted text containing output markers
    # must not be interpreted as another template substitution.
    fragments: list[str] = []
    for part in form.parts:
        if isinstance(part, MarkdownFragment):
            fragments.append(part.text)
            continue
        segment = inputs.get(part.output_variable_name)
        if segment is None or segment.to_object() is None:
            continue
        match part:
            case ParagraphInput() | SelectInput():
                fragments.append(segment.text)
            case FileInput():
                fragments.append("[file]")
            case FileListInput():
                assert isinstance(segment, ArrayFileSegment), "Accepted file-list input must retain its Segment type"
                fragments.append(f"[{len(segment.value)} files]")
            case _:
                assert_never(part)
    return "".join(fragments)
