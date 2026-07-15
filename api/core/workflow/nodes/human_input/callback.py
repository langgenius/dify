from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any

from configs import dify_config
from core.repositories.human_input_repository import FormCreateParams, HumanInputFormEntity, HumanInputFormRepository
from core.workflow.human_input_adapter import DeliveryChannelConfig
from core.workflow.node_runtime import DifyFileReferenceFactory
from graphon.nodes.human_input.entities import Completed, Expired, HITLContext, HITLDecision, PauseRequested
from graphon.runtime import VariablePool
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.factory import build_segment
from graphon.variables.segments import Segment
from libs.datetime_utils import ensure_naive_utc, naive_utc_now

from .entities import (
    FileInputConfig,
    FileListInputConfig,
    FormInputConfig,
    HumanInputNodeData,
    ParagraphInputConfig,
    SelectInputConfig,
)
from .enums import HumanInputFormStatus
from .session_binding import default_session_binding

logger = logging.getLogger(__name__)


def _require_template_variable_pool(pool: ReadOnlyVariablePool) -> VariablePool:
    """Return the concrete graphon pool required for template expansion."""
    if isinstance(pool, VariablePool):
        return pool

    msg = "human input rendering requires graphon.runtime.VariablePool for template expansion"
    raise TypeError(msg)


def render_form_content_before_submission(
    node_data: HumanInputNodeData,
    *,
    variable_pool: ReadOnlyVariablePool,
) -> str:
    """Process form content by substituting runtime variables before pause."""
    # NOTE(QuantumGhost): This is not ideal, we should expose
    # VariablePool method in Graphon.
    rendered_form_content = _require_template_variable_pool(variable_pool).convert_template(node_data.form_content)
    return rendered_form_content.markdown


def resolve_default_values(
    node_data: HumanInputNodeData,
    *,
    variable_pool: ReadOnlyVariablePool,
) -> Mapping[str, Any]:
    resolved_defaults: dict[str, Any] = {}
    for form_input in node_data.inputs:
        resolved_default = form_input.resolve_default_value(variable_pool)
        if resolved_default is None:
            continue
        resolved_defaults[form_input.output_variable_name] = resolved_default.to_object()
    return resolved_defaults


class DifyHITLCallback:
    """Bridge Dify human-input semantics onto graphon HITL decisions.

    The boundary preserves Dify's split between node timeout and global
    expiration: only explicit node timeout resumes along the timeout handle,
    while global expiration is treated as an invalid resume state.
    """

    pause_requested_type = PauseRequested

    _OUTPUT_FIELD_ACTION_ID = "__action_id"
    _OUTPUT_FIELD_ACTION_VALUE = "__action_value"
    _OUTPUT_FIELD_RENDERED_CONTENT = "__rendered_content"
    _TIMEOUT_HANDLE = "__timeout__"

    def __init__(
        self,
        *,
        form_repository: HumanInputFormRepository,
        node_data: HumanInputNodeData,
        workflow_execution_id: str | None = None,
        conversation_id: str | None = None,
        delivery_methods: Sequence[DeliveryChannelConfig] = (),
        display_in_ui: bool = False,
        file_reference_factory: DifyFileReferenceFactory | None = None,
    ) -> None:
        self._form_repository = form_repository
        self._session_binding = default_session_binding
        self._node_data = node_data
        self._workflow_execution_id = workflow_execution_id
        self._conversation_id = conversation_id
        self._delivery_methods = tuple(delivery_methods)
        self._display_in_ui = display_in_ui
        self._file_reference_factory = file_reference_factory

    def __call__(self, ctx: HITLContext) -> HITLDecision:
        form = self._form_repository.get_form(ctx.node_id)
        if form is None:
            created = self._create_form(ctx)
            return PauseRequested(session_id=self._session_binding.issue_session_id_for_form(form_id=created.id))

        status = self._normalize_status(form.status)
        if status == HumanInputFormStatus.TIMEOUT.value:
            return Expired(
                selected_handle=self._TIMEOUT_HANDLE,
                outputs=self._build_special_outputs(
                    action_id="",
                    action_value="",
                    rendered_content=form.rendered_content,
                ),
            )

        if status == HumanInputFormStatus.EXPIRED.value:
            msg = f"cannot resume globally expired human input form, form_id={form.id}"
            raise AssertionError(msg)

        if not form.submitted:
            if status == HumanInputFormStatus.WAITING.value and self._is_past_global_deadline(form.created_at):
                msg = f"cannot resume waiting human input form after global timeout, form_id={form.id}"
                raise AssertionError(msg)
            if self._is_past_node_deadline(form.expiration_time):
                return Expired(
                    selected_handle=self._TIMEOUT_HANDLE,
                    outputs=self._build_special_outputs(
                        action_id="",
                        action_value="",
                        rendered_content=form.rendered_content,
                    ),
                )
            return PauseRequested(session_id=self._session_binding.issue_session_id_for_form(form_id=form.id))

        selected_action_id = form.selected_action_id
        if selected_action_id is None:
            msg = f"selected_action_id should not be None when form submitted, form_id={form.id}"
            raise AssertionError(msg)

        submitted_data = self._restore_submitted_data(submitted_data=form.submitted_data or {})
        rendered_content = self.render_form_content_with_outputs(
            form.rendered_content,
            submitted_data,
            self._node_data.outputs_field_names(),
            self._node_data.inputs,
        )
        outputs = dict(submitted_data)
        outputs.update(
            self._build_special_outputs(
                action_id=selected_action_id,
                action_value=self._node_data.must_resolve_action_value(selected_action_id),
                rendered_content=rendered_content,
            )
        )
        return Completed(
            selected_handle=selected_action_id,
            inputs=submitted_data,
            outputs=outputs,
        )

    def _create_form(self, ctx: HITLContext) -> HumanInputFormEntity:
        params = FormCreateParams(
            workflow_execution_id=self._workflow_execution_id or ctx.workflow_execution_id,
            conversation_id=self._conversation_id,
            node_id=ctx.node_id,
            form_config=self._node_data,
            rendered_content=render_form_content_before_submission(
                self._node_data,
                variable_pool=ctx.variable_pool,
            ),
            delivery_methods=self._delivery_methods,
            display_in_ui=self._display_in_ui,
            resolved_default_values=dict(
                resolve_default_values(
                    self._node_data,
                    variable_pool=ctx.variable_pool,
                )
            ),
        )
        return self._form_repository.create_form(params)

    @staticmethod
    def _normalize_status(status: HumanInputFormStatus | str) -> str:
        if isinstance(status, HumanInputFormStatus):
            return status.value
        return status

    @staticmethod
    def _is_past_node_deadline(expiration_time: datetime) -> bool:
        expiration_time = ensure_naive_utc(expiration_time)
        return expiration_time <= naive_utc_now()

    @staticmethod
    def _is_past_global_deadline(created_at: datetime) -> bool:
        global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS
        if global_timeout_seconds <= 0:
            return False
        global_deadline = ensure_naive_utc(created_at) + timedelta(seconds=global_timeout_seconds)
        return global_deadline <= naive_utc_now()

    @staticmethod
    def render_form_content_with_outputs(
        form_content: str,
        outputs: Mapping[str, Segment],
        field_names: Sequence[str],
        form_inputs: Sequence[FormInputConfig] | None = None,
    ) -> str:
        """Replace {{#$output.xxx#}} placeholders with submitted values.

        Text inputs render their submitted value directly. File inputs render as
        stable placeholders so the final content stays readable and does not
        inline transport metadata.

        Returns:
            the interplated form content
        """
        inputs_by_name: dict[str, FormInputConfig] = {}
        if form_inputs is not None:
            inputs_by_name = {form_input.output_variable_name: form_input for form_input in form_inputs}

        rendered_content = form_content
        for field_name in field_names:
            placeholder = "{{#$output." + field_name + "#}}"
            replacement = DifyHITLCallback._render_output_placeholder_value(
                value=outputs.get(field_name),
                form_input=inputs_by_name.get(field_name),
            )
            rendered_content = rendered_content.replace(placeholder, replacement)
        return rendered_content

    @staticmethod
    def _render_output_placeholder_value(
        *,
        value: Any,
        form_input: FormInputConfig | None,
    ) -> str:
        if isinstance(value, Segment):
            value = value.to_object()

        if value is None:
            return ""

        if isinstance(form_input, FileInputConfig):
            return "[file]"

        if isinstance(form_input, FileListInputConfig):
            file_count = 0
            if isinstance(value, Sequence) and not isinstance(value, str | bytes):
                file_count = len(value)
            return f"[{file_count} files]"

        if isinstance(form_input, ParagraphInputConfig | SelectInputConfig):
            return str(value)

        if isinstance(value, dict | list):
            return json.dumps(value, ensure_ascii=False)

        return str(value)

    def _restore_submitted_data(
        self,
        *,
        submitted_data: Mapping[str, Any],
    ) -> dict[str, Segment]:
        """Reconstruct graphon runtime values from validated submission payloads."""
        restored_data: dict[str, Segment] = {}
        inputs_by_name = {form_input.output_variable_name: form_input for form_input in self._node_data.inputs}

        for name, value in submitted_data.items():
            form_input = inputs_by_name.get(name)
            if form_input is None:
                logger.error("unexpected form data in submitted data, key=%s", name)
                continue
            restored_data[name] = build_segment(self._restore_submitted_value(input_config=form_input, value=value))

        return restored_data

    def _restore_submitted_value(
        self,
        *,
        input_config: FormInputConfig,
        value: Any,
    ) -> Any:
        if isinstance(input_config, FileInputConfig):
            if not isinstance(value, Mapping):
                raise ValueError(
                    "HumanInput file submission must be persisted as a mapping, "
                    f"output_variable_name={input_config.output_variable_name}"
                )
            return self._build_file_reference(mapping=value)

        if isinstance(input_config, FileListInputConfig):
            if not isinstance(value, list):
                raise ValueError(
                    "HumanInput file-list submission must be persisted as a list, "
                    f"output_variable_name={input_config.output_variable_name}"
                )
            if any(not isinstance(item, Mapping) for item in value):
                raise ValueError(
                    "HumanInput file-list submission must contain mappings, "
                    f"output_variable_name={input_config.output_variable_name}"
                )
            return [self._build_file_reference(mapping=item) for item in value]

        return value

    def _build_file_reference(self, *, mapping: Mapping[str, Any]) -> Any:
        if self._file_reference_factory is None:
            raise ValueError("file_reference_factory is required to restore file submissions")
        return self._file_reference_factory.build_from_mapping(mapping=mapping)

    @classmethod
    def _build_special_outputs(
        cls,
        *,
        action_id: str,
        action_value: str,
        rendered_content: str,
    ) -> dict[str, Segment]:
        return {
            cls._OUTPUT_FIELD_ACTION_ID: build_segment(action_id),
            cls._OUTPUT_FIELD_ACTION_VALUE: build_segment(action_value),
            cls._OUTPUT_FIELD_RENDERED_CONTENT: build_segment(rendered_content),
        }
