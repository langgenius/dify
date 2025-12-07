from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from core.entities.execution_extra_content import HumanInputContent as HumanInputContentDomain
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    HumanInputFormStatus,
    TimeoutUnit,
    UserAction,
)
from models.execution_extra_content import HumanInputContent as HumanInputContentModel
from models.human_input import HumanInputForm
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository


class _FakeScalarResult:
    def __init__(self, values: Sequence[HumanInputContentModel]):
        self._values = list(values)

    def all(self) -> list[HumanInputContentModel]:
        return list(self._values)


class _FakeSession:
    def __init__(self, values: Sequence[HumanInputContentModel]):
        self._values = values

    def scalars(self, _stmt):
        return _FakeScalarResult(self._values)

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
    definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserAction(id=action_id, title=action_title)],
        rendered_content="rendered",
        timeout=1,
        timeout_unit=TimeoutUnit.HOUR,
    )
    form = HumanInputForm(
        id=f"form-{action_id}",
        tenant_id="tenant-id",
        workflow_run_id="workflow-run",
        node_id="node-id",
        form_definition=definition.model_dump_json(),
        rendered_content=rendered_content,
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=datetime.now(UTC) + timedelta(days=1),
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
    repository = SQLAlchemyExecutionExtraContentRepository(
        session_maker=_FakeSessionMaker(session=_FakeSession(values=[_build_content("msg-1", "approve", "Approve")]))
    )

    result = repository.get_by_message_ids(message_ids)

    assert len(result) == 2
    assert [content.to_dict() for content in result[0]] == [
        HumanInputContentDomain(
            action_id="approve",
            action_text="Approve",
            rendered_content="Rendered Approve",
        ).to_dict()
    ]
    assert result[1] == []
