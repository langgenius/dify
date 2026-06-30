import importlib
import inspect
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import pytest

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormEntity, HumanInputFormRepository
from core.workflow.human_input import (
    HumanInputFormStatus,
    HumanInputNodeData,
    ParagraphInputConfig,
    StringSource,
    UserActionConfig,
    ValueSourceType,
    session_binding,
)
from graphon.variables.segments import StringSegment
from libs.datetime_utils import naive_utc_now


def _load_callback_module():
    try:
        return importlib.import_module("core.workflow.human_input.callback")
    except ModuleNotFoundError as exc:
        pytest.fail(f"expected Dify-owned HITL callback module at 'core.workflow.human_input.callback': {exc}")


def _load_graphon_hitl_entities():
    module = importlib.import_module("graphon.nodes.human_input.entities")
    missing = [name for name in ("Completed", "Expired", "HITLContext", "PauseRequested") if not hasattr(module, name)]
    if missing:
        pytest.fail(
            "expected graphon-185 HITL entities in 'graphon.nodes.human_input.entities', missing: " + ", ".join(missing)
        )
    return module


@dataclass
class _FakeRenderedTemplate:
    markdown: str


class _FakeVariablePool:
    def convert_template(self, template: str) -> _FakeRenderedTemplate:
        assert template == "Question for {{#start.user#}}: {{#$output.note#}}"
        return _FakeRenderedTemplate("Question for Alice: {{#$output.note#}}")

    def get(self, selector: tuple[str, ...]) -> StringSegment | None:
        if selector == ("start", "note_default"):
            return StringSegment(value="Need review")
        return None


@dataclass
class _FakeForm(HumanInputFormEntity):
    form_id: str
    rendered: str
    status_value: HumanInputFormStatus
    submitted_payload: dict[str, Any] | None = None
    action_id: str | None = None
    expiration: datetime = naive_utc_now() + timedelta(days=1)

    @property
    def id(self) -> str:
        return self.form_id

    @property
    def submission_token(self) -> str | None:
        return None

    @property
    def recipients(self) -> list:
        return []

    @property
    def rendered_content(self) -> str:
        return self.rendered

    @property
    def selected_action_id(self) -> str | None:
        return self.action_id

    @property
    def submitted_data(self) -> dict[str, Any] | None:
        return self.submitted_payload

    @property
    def submitted(self) -> bool:
        return self.status_value == HumanInputFormStatus.SUBMITTED

    @property
    def status(self) -> HumanInputFormStatus:
        return self.status_value

    @property
    def expiration_time(self) -> datetime:
        return self.expiration


class _FakeRepository(HumanInputFormRepository):
    def __init__(self, form: HumanInputFormEntity | None = None) -> None:
        self._form = form
        self.created_params: list[FormCreateParams] = []

    def get_form(self, node_id: str) -> HumanInputFormEntity | None:
        assert node_id == "human-node"
        return self._form

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        self.created_params.append(params)
        self._form = _FakeForm(
            form_id="form-new",
            rendered=params.rendered_content,
            status_value=HumanInputFormStatus.WAITING,
        )
        return self._form


def _build_node_data() -> HumanInputNodeData:
    return HumanInputNodeData(
        title="Human Review",
        form_content="Question for {{#start.user#}}: {{#$output.note#}}",
        inputs=[
            ParagraphInputConfig(
                output_variable_name="note",
                default=StringSource(
                    type=ValueSourceType.VARIABLE,
                    selector=("start", "note_default"),
                ),
            )
        ],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )


def _build_context():
    hitl_entities = _load_graphon_hitl_entities()
    return hitl_entities.HITLContext(
        workflow_execution_id="wf-exec-1",
        node_id="human-node",
        node_title="Human Review",
        variable_pool=_FakeVariablePool(),
    )


def _construct_callback(*, node_data: HumanInputNodeData, repository: HumanInputFormRepository):
    module = _load_callback_module()
    entrypoint = next(
        (
            getattr(module, name)
            for name in ("DifyHumanInputCallback", "build_hitl_callback", "build_dify_human_input_hitl_callback")
            if hasattr(module, name)
        ),
        None,
    )
    if entrypoint is None:
        pytest.fail(
            "expected callback module to expose one of: "
            "DifyHumanInputCallback, build_hitl_callback, build_dify_human_input_hitl_callback"
        )

    candidate_kwargs = {
        "node_data": node_data,
        "human_input_node_data": node_data,
        "repository": repository,
        "form_repository": repository,
        "session_binding": session_binding,
    }
    signature = inspect.signature(entrypoint)
    kwargs = {name: value for name, value in candidate_kwargs.items() if name in signature.parameters}
    return entrypoint(**kwargs)


def test_hitl_callback_creates_form_and_returns_pause_requested_on_first_pause() -> None:
    repository = _FakeRepository()
    callback = _construct_callback(node_data=_build_node_data(), repository=repository)
    hitl_entities = _load_graphon_hitl_entities()

    result = callback(_build_context())

    assert isinstance(result, hitl_entities.PauseRequested)
    assert result.session_id == session_binding.issue_session_id_for_form(form_id="form-new")
    assert len(repository.created_params) == 1
    params = repository.created_params[0]
    assert params.workflow_execution_id == "wf-exec-1"
    assert params.node_id == "human-node"
    assert params.rendered_content == "Question for Alice: {{#$output.note#}}"
    assert params.resolved_default_values == {"note": "Need review"}


def test_hitl_callback_preserves_constant_paragraph_defaults_in_resolved_default_values() -> None:
    repository = _FakeRepository()
    node_data = HumanInputNodeData(
        title="Human Review",
        form_content="Question for {{#start.user#}}: {{#$output.note#}}",
        inputs=[
            ParagraphInputConfig(
                output_variable_name="note",
                default=StringSource(type=ValueSourceType.CONSTANT, value="Need review"),
            )
        ],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    callback = _construct_callback(node_data=node_data, repository=repository)

    callback(_build_context())

    assert repository.created_params[0].resolved_default_values == {"note": "Need review"}


def test_hitl_callback_returns_completed_with_restored_inputs_outputs_and_selected_handle() -> None:
    repository = _FakeRepository(
        _FakeForm(
            form_id="form-submitted",
            rendered="Question for Alice: {{#$output.note#}}",
            status_value=HumanInputFormStatus.SUBMITTED,
            submitted_payload={"note": "Approved"},
            action_id="approve",
        )
    )
    callback = _construct_callback(node_data=_build_node_data(), repository=repository)
    hitl_entities = _load_graphon_hitl_entities()

    result = callback(_build_context())

    assert isinstance(result, hitl_entities.Completed)
    assert result.selected_handle == "approve"
    assert result.inputs["note"] == StringSegment(value="Approved")
    assert result.outputs["note"] == StringSegment(value="Approved")
    assert result.outputs["__action_id"] == StringSegment(value="approve")
    assert result.outputs["__rendered_content"] == StringSegment(value="Question for Alice: Approved")


@pytest.mark.parametrize("status", [HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED])
def test_hitl_callback_returns_expired_when_form_is_timed_out_or_expired(status: HumanInputFormStatus) -> None:
    repository = _FakeRepository(
        _FakeForm(
            form_id="form-expired",
            rendered="Question for Alice: {{#$output.note#}}",
            status_value=status,
        )
    )
    callback = _construct_callback(node_data=_build_node_data(), repository=repository)
    hitl_entities = _load_graphon_hitl_entities()

    result = callback(_build_context())

    assert isinstance(result, hitl_entities.Expired)
    assert result.selected_handle == "__timeout"
    assert result.outputs["__rendered_content"] == StringSegment(value="Question for Alice: {{#$output.note#}}")


def test_hitl_callback_repauses_while_existing_form_is_still_waiting() -> None:
    repository = _FakeRepository(
        _FakeForm(
            form_id="form-waiting",
            rendered="Question for Alice: {{#$output.note#}}",
            status_value=HumanInputFormStatus.WAITING,
        )
    )
    callback = _construct_callback(node_data=_build_node_data(), repository=repository)
    hitl_entities = _load_graphon_hitl_entities()

    result = callback(_build_context())

    assert isinstance(result, hitl_entities.PauseRequested)
    assert result.session_id == session_binding.issue_session_id_for_form(form_id="form-waiting")
    assert repository.created_params == []
