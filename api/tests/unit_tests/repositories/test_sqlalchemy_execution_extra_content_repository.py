from __future__ import annotations

import json
from datetime import timedelta
from typing import cast

from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.entities import FormDefinition, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from libs.datetime_utils import naive_utc_now
from models.execution_extra_content import HumanInputContent as HumanInputContentModel
from models.human_input import HumanInputForm
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository


def test_map_human_input_content_populates_submission_data_from_stored_form_submission() -> None:
    expiration_time = naive_utc_now() + timedelta(days=1)
    stored_submission_data = {"decision": "approve", "comment": "Looks good"}
    form_definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="Rendered Approve",
        expiration_time=expiration_time,
        node_title="Approval",
        display_in_ui=True,
    )
    form = HumanInputForm(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        form_definition=form_definition.model_dump_json(),
        rendered_content="Rendered Approve",
        expiration_time=expiration_time,
        selected_action_id="approve",
        submitted_data=json.dumps(stored_submission_data),
        submitted_at=naive_utc_now(),
        status=HumanInputFormStatus.SUBMITTED,
    )
    form.id = "form-1"
    model = HumanInputContentModel.new(
        workflow_run_id="workflow-run-1",
        form_id=form.id,
        message_id="message-1",
    )
    model.id = "content-1"
    model.form = form
    repository = SQLAlchemyExecutionExtraContentRepository(cast(sessionmaker[Session], object()))

    content = repository._map_human_input_content(model, {})

    assert content is not None
    assert content.form_submission_data is not None
    assert content.form_submission_data.submitted_data == stored_submission_data


def test_map_human_input_content_keeps_waiting_form_without_selected_action() -> None:
    expiration_time = naive_utc_now() + timedelta(days=1)
    form_definition = FormDefinition(
        form_content="content",
        inputs=[],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="Rendered Approval",
        expiration_time=expiration_time,
        node_title="Approval",
        display_in_ui=True,
        default_values={"decision": "approve"},
    )
    form = HumanInputForm(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        form_definition=form_definition.model_dump_json(),
        rendered_content="Rendered Approval",
        expiration_time=expiration_time,
        status=HumanInputFormStatus.WAITING,
    )
    form.id = "form-1"
    model = HumanInputContentModel.new(
        workflow_run_id="workflow-run-1",
        form_id=form.id,
        message_id="message-1",
    )
    model.id = "content-1"
    model.form = form
    repository = SQLAlchemyExecutionExtraContentRepository(cast(sessionmaker[Session], object()))

    content = repository._map_human_input_content(model, {})

    assert content is not None
    assert content.submitted is False
    assert content.form_submission_data is None
    assert content.form_definition is not None
    assert content.form_definition.form_id == "form-1"
    assert content.form_definition.node_id == "node-1"
    assert content.form_definition.node_title == "Approval"
    assert content.form_definition.form_content == "Rendered Approval"
    assert content.form_definition.resolved_default_values == {"decision": "approve"}
