"""Restore message approvals through their version-specific storage owners."""

import logging
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy.orm import Session, sessionmaker

from core.entities.execution_extra_content import (
    ExecutionExtraContentDomainModel,
    HumanInputContent,
    HumanInputFormDefinition,
    HumanInputFormSubmissionData,
)
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from factories.human_input_v2_form_presentation import build_form_presentation, render_filled_content
from libs.datetime_utils import to_utc_timestamp
from repositories.execution_extra_content_repository import ExecutionExtraContentRepository, HumanInputFormReference
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from services.human_input_v2.form_service import load_prepared_forms

logger = logging.getLogger(__name__)


def load_message_extra_contents(
    *,
    repository: ExecutionExtraContentRepository,
    message_ids: Sequence[str],
    session_factory: sessionmaker[Session],
) -> list[list[ExecutionExtraContentDomainModel]]:
    """The caller admits the messages; preserve their content and form ordering.

    V1 content is already projected by the legacy repository. V2 references
    recover only their original initiator grants, without creating deliveries.
    """
    contents = repository.get_by_message_ids(message_ids)
    references_by_run: dict[str, list[HumanInputFormReference]] = defaultdict(list)
    for message_contents in contents:
        for content in message_contents:
            if isinstance(content, HumanInputFormReference):
                references_by_run[content.workflow_run_id].append(content)

    restored: dict[HumanInputFormReference, HumanInputContent] = {}
    nodes = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_maker=session_factory)
    for run_id, references in references_by_run.items():
        prepared_forms = load_prepared_forms(
            workflow_run_id=run_id,
            form_ids=[reference.form_id for reference in references],
            session_factory=session_factory,
        )
        if not prepared_forms:
            logger.warning("No approval forms found for message history: workflow_run_id=%s", run_id)
            continue
        owner = next(iter(prepared_forms.values())).form
        executions = nodes.get_executions_by_workflow_run(str(owner.tenant_id), owner.app_id, run_id)
        node_ids = {execution.id: execution.node_id for execution in executions}
        for reference in references:
            prepared = prepared_forms.get(reference.form_id)
            execution_id = prepared.form.node_execution_id if prepared is not None else None
            node_id = node_ids.get(execution_id) if execution_id is not None else None
            if prepared is None or node_id is None:
                logger.warning(
                    "Approval form or execution missing from message history: workflow_run_id=%s form_id=%s",
                    run_id,
                    reference.form_id,
                )
                continue
            restored[reference] = _restore_v2_content(prepared, workflow_run_id=run_id, node_id=node_id)

    resolved: list[list[ExecutionExtraContentDomainModel]] = []
    for message_contents in contents:
        message_resolved: list[ExecutionExtraContentDomainModel] = []
        for content in message_contents:
            if isinstance(content, HumanInputFormReference):
                if (form_content := restored.get(content)) is not None:
                    message_resolved.append(form_content)
            else:
                message_resolved.append(content)
        resolved.append(message_resolved)
    return resolved


def _restore_v2_content(prepared: PreparedForm, *, workflow_run_id: str, node_id: str) -> HumanInputContent:
    form = prepared.form
    presentation = build_form_presentation(form.resolved_form)
    definition = HumanInputFormDefinition(
        form_id=form.id,
        form_version="2",
        node_id=node_id,
        node_title=form.resolved_form.title,
        form_content=presentation.form_content,
        inputs=presentation.inputs,
        actions=presentation.user_actions,
        resolved_default_values=presentation.resolved_default_values,
        expiration_time=to_utc_timestamp(form.expiration_time),
        display_in_ui=prepared.form_token is not None,
        form_token=prepared.form_token.get_secret_value() if prepared.form_token is not None else None,
    )
    submission = form.submission
    submitted = None
    if submission is not None:
        action_text = next(
            (action.title for action in form.resolved_form.actions if action.id == submission.selected_action_id),
            submission.selected_action_id,
        )
        submitted = HumanInputFormSubmissionData(
            node_id=node_id,
            node_title=form.resolved_form.title,
            rendered_content=render_filled_content(form.resolved_form, submission.normalized_submission_data),
            action_id=submission.selected_action_id,
            action_text=action_text,
            submitted_data=submission.raw_submission_inputs,
        )
    return HumanInputContent(
        workflow_run_id=workflow_run_id,
        submitted=submission is not None,
        form_definition=definition,
        form_submission_data=submitted,
    )
