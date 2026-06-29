"""Dify-owned HITL callback for graphon Human Input nodes.

This module keeps Dify's persisted human-input form semantics on the Dify side
of the graph boundary. Graphon only sees the final HITL decision objects
(`PauseRequested`, `Completed`, `Expired`) returned from this callback.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepository
from core.workflow.human_input import (
    HumanInputFormStatus,
    HumanInputNodeData,
    render_form_content_before_submission,
    render_form_content_with_outputs,
    resolve_default_values,
    restore_submitted_data,
    session_binding as default_session_binding,
)
from factories.variable_factory import build_segment
from graphon.nodes.human_input.entities import Completed, Expired, HITLContext, PauseRequested
from graphon.variables.segments import Segment

_TIMEOUT_HANDLE = "__timeout"
_ACTION_ID_OUTPUT = "__action_id"
_RENDERED_CONTENT_OUTPUT = "__rendered_content"

type RepositoryFactory = Callable[[str], HumanInputFormRepository]
type FileValueRestorer = Callable[[Mapping[str, Any]], Any]


class DifyHumanInputCallback:
    """Bridge graphon HITL decisions to Dify-owned form persistence."""

    def __init__(
        self,
        *,
        node_data: HumanInputNodeData,
        repository: HumanInputFormRepository | None = None,
        repository_factory: RepositoryFactory | None = None,
        session_binding=default_session_binding,
        file_value_restorer: FileValueRestorer | None = None,
        delivery_methods: Sequence[Any] = (),
        display_in_ui: bool = True,
        conversation_id_getter: Callable[[], str | None] | None = None,
    ) -> None:
        if repository is None and repository_factory is None:
            raise ValueError("repository or repository_factory is required for DifyHumanInputCallback")

        self._node_data = node_data
        self._repository = repository
        self._repository_factory = repository_factory
        self._session_binding = session_binding
        self._file_value_restorer = file_value_restorer or (lambda mapping: mapping)
        self._delivery_methods = list(delivery_methods)
        self._display_in_ui = display_in_ui
        self._conversation_id_getter = conversation_id_getter

    def __call__(self, context: HITLContext) -> PauseRequested | Completed | Expired:
        repository = self._resolve_repository(workflow_execution_id=context.workflow_execution_id)
        form = repository.get_form(context.node_id)
        if form is None:
            created_form = repository.create_form(
                FormCreateParams(
                    workflow_execution_id=context.workflow_execution_id,
                    conversation_id=self._conversation_id(),
                    node_id=context.node_id,
                    form_config=self._node_data,
                    rendered_content=render_form_content_before_submission(
                        form_content=self._node_data.form_content,
                        variable_pool=context.variable_pool,
                    ),
                    delivery_methods=self._delivery_methods,
                    display_in_ui=self._display_in_ui,
                    resolved_default_values=self._resolve_default_values(context=context),
                )
            )
            return PauseRequested(session_id=self._session_binding.issue_session_id_for_form(form_id=created_form.id))

        if form.status == HumanInputFormStatus.WAITING:
            return PauseRequested(session_id=self._session_binding.issue_session_id_for_form(form_id=form.id))

        if form.status == HumanInputFormStatus.SUBMITTED:
            restored_values = dict(
                restore_submitted_data(
                    node_data=self._node_data,
                    submitted_data=form.submitted_data or {},
                    file_value_restorer=self._file_value_restorer,
                )
            )
            selected_handle = form.selected_action_id or self._default_selected_handle()
            rendered_content = render_form_content_with_outputs(
                form.rendered_content,
                restored_values,
                self._node_data.outputs_field_names(),
                self._node_data.inputs,
            )
            inputs = self._to_segments(restored_values)
            outputs = dict(inputs)
            outputs[_ACTION_ID_OUTPUT] = build_segment(selected_handle)
            outputs[_RENDERED_CONTENT_OUTPUT] = build_segment(rendered_content)
            return Completed(
                selected_handle=selected_handle,
                inputs=inputs,
                outputs=outputs,
            )

        if form.status in {HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED}:
            return Expired(
                selected_handle=_TIMEOUT_HANDLE,
                outputs={
                    _RENDERED_CONTENT_OUTPUT: build_segment(form.rendered_content),
                },
            )

        raise AssertionError(f"unsupported human-input form status: {form.status}")

    def _resolve_repository(self, *, workflow_execution_id: str) -> HumanInputFormRepository:
        if self._repository is not None:
            return self._repository
        assert self._repository_factory is not None
        return self._repository_factory(workflow_execution_id)

    def _conversation_id(self) -> str | None:
        if self._conversation_id_getter is None:
            return None
        return self._conversation_id_getter()

    def _resolve_default_values(self, *, context: HITLContext) -> dict[str, Any]:
        return resolve_default_values(node_data=self._node_data, variable_pool=context.variable_pool)

    @staticmethod
    def _segment_value(segment: Segment) -> Any:
        value = getattr(segment, "value", None)
        if value is not None:
            return value
        return segment.text

    @staticmethod
    def _to_segments(values: Mapping[str, Any]) -> dict[str, Segment]:
        return {name: build_segment(value) for name, value in values.items()}

    def _default_selected_handle(self) -> str:
        if self._node_data.user_actions:
            return self._node_data.user_actions[0].id
        return "submit"


def build_dify_human_input_hitl_callback(
    *,
    node_data: HumanInputNodeData,
    repository: HumanInputFormRepository | None = None,
    repository_factory: RepositoryFactory | None = None,
    session_binding=default_session_binding,
    file_value_restorer: FileValueRestorer | None = None,
    delivery_methods: Sequence[Any] = (),
    display_in_ui: bool = True,
    conversation_id_getter: Callable[[], str | None] | None = None,
) -> DifyHumanInputCallback:
    return DifyHumanInputCallback(
        node_data=node_data,
        repository=repository,
        repository_factory=repository_factory,
        session_binding=session_binding,
        file_value_restorer=file_value_restorer,
        delivery_methods=delivery_methods,
        display_in_ui=display_in_ui,
        conversation_id_getter=conversation_id_getter,
    )


build_hitl_callback = build_dify_human_input_hitl_callback


__all__ = [
    "DifyHumanInputCallback",
    "build_dify_human_input_hitl_callback",
    "build_hitl_callback",
]
