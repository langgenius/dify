from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from core.entities.execution_extra_content import HumanInputContent as HumanInputContentDomain
from core.entities.execution_extra_content import HumanInputFormSubmissionData
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    UserAction,
)
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from models.execution_extra_content import HumanInputContent as HumanInputContentModel
from models.human_input import ConsoleRecipientPayload, HumanInputForm, HumanInputFormRecipient, RecipientType
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository


class _FakeScalarResult:
    def __init__(self, values: Sequence[HumanInputContentModel]):
        self._values = list(values)

    def all(self) -> list[HumanInputContentModel]:
        return list(self._values)


class _FakeSession:
    def __init__(self, values: Sequence[Sequence[object]]):
        self._values = list(values)

    def scalars(self, _stmt):
        if not self._values:
            return _FakeScalarResult([])
        return _FakeScalarResult(self._values.pop(0))

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


@dataclass
class _FakeSessionMaker:
    session: _FakeSession

    def __call__(self) -> _FakeSession:
        return self.session


def _build_form(action_id: str, action_title: str, rendered_content: str) -> HumanInputForm:
    expiration_time = datetime.now(UTC) + timedelta(days=1)
    definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserAction(id=action_id, title=action_title)],
        rendered_content="rendered",
        expiration_time=expiration_time,
        node_title="Approval",
        display_in_ui=True,
    )
    form = HumanInputForm(
        id=f"form-{action_id}",
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_run_id="workflow-run",
        node_id="node-id",
        form_definition=definition.model_dump_json(),
        rendered_content=rendered_content,
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=expiration_time,
    )
    form.selected_action_id = action_id
    return form


def _build_content(message_id: str, action_id: str, action_title: str) -> HumanInputContentModel:
    form = _build_form(
        action_id=action_id,
        action_title=action_title,
        rendered_content=f"Rendered {action_title}",
    )
    content = HumanInputContentModel(
        id=f"content-{message_id}",
        form_id=form.id,
        message_id=message_id,
        workflow_run_id=form.workflow_run_id,
    )
    content.form = form
    return content


def test_get_by_message_ids_groups_contents_by_message() -> None:
    message_ids = ["msg-1", "msg-2"]
    contents = [_build_content("msg-1", "approve", "Approve")]
    repository = SQLAlchemyExecutionExtraContentRepository(
        session_maker=_FakeSessionMaker(session=_FakeSession(values=[contents, []]))
    )

    result = repository.get_by_message_ids(message_ids)

    assert len(result) == 2
    assert [content.model_dump(mode="json", exclude_none=True) for content in result[0]] == [
        HumanInputContentDomain(
            workflow_run_id="workflow-run",
            submitted=True,
            form_submission_data=HumanInputFormSubmissionData(
                node_id="node-id",
                node_title="Approval",
                rendered_content="Rendered Approve",
                action_id="approve",
                action_text="Approve",
            ),
        ).model_dump(mode="json", exclude_none=True)
    ]
    assert result[1] == []


def test_get_by_message_ids_returns_unsubmitted_form_definition() -> None:
    expiration_time = datetime.now(UTC) + timedelta(days=1)
    definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserAction(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=expiration_time,
        default_values={"name": "John"},
        node_title="Approval",
        display_in_ui=True,
    )
    form = HumanInputForm(
        id="form-1",
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_run_id="workflow-run",
        node_id="node-id",
        form_definition=definition.model_dump_json(),
        rendered_content="Rendered block",
        status=HumanInputFormStatus.WAITING,
        expiration_time=expiration_time,
    )
    content = HumanInputContentModel(
        id="content-msg-1",
        form_id=form.id,
        message_id="msg-1",
        workflow_run_id=form.workflow_run_id,
    )
    content.form = form

    recipient = HumanInputFormRecipient(
        form_id=form.id,
        delivery_id="delivery-1",
        recipient_type=RecipientType.CONSOLE,
        recipient_payload=ConsoleRecipientPayload(account_id=None).model_dump_json(),
        access_token="token-1",
    )

    repository = SQLAlchemyExecutionExtraContentRepository(
        session_maker=_FakeSessionMaker(session=_FakeSession(values=[[content], [recipient]]))
    )

    result = repository.get_by_message_ids(["msg-1"])

    assert len(result) == 1
    assert len(result[0]) == 1
    domain_content = result[0][0]
    assert domain_content.submitted is False
    assert domain_content.workflow_run_id == "workflow-run"
    assert domain_content.form_definition is not None
    assert domain_content.form_definition.expiration_time == int(form.expiration_time.timestamp())
    assert domain_content.form_definition is not None
    form_definition = domain_content.form_definition
    assert form_definition.form_id == "form-1"
    assert form_definition.node_id == "node-id"
    assert form_definition.node_title == "Approval"
    assert form_definition.form_content == "Rendered block"
    assert form_definition.display_in_ui is True
    assert form_definition.form_token == "token-1"
    assert form_definition.resolved_default_values == {"name": "John"}
    assert form_definition.expiration_time == int(form.expiration_time.timestamp())
