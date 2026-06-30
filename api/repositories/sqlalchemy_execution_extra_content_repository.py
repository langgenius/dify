from __future__ import annotations

import json
import logging
from collections import defaultdict
from collections.abc import Sequence
from typing import Any, override

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.entities.execution_extra_content import (
    ExecutionExtraContentDomainModel,
    HumanInputFormDefinition,
    HumanInputFormSubmissionData,
)
from core.entities.execution_extra_content import (
    HumanInputContent as HumanInputContentDomainModel,
)
from core.workflow.human_input import (
    FormDefinition,
    HumanInputFormStatus,
    extract_output_field_names,
    render_form_content_with_outputs,
)
from models.execution_extra_content import (
    ExecutionExtraContent as ExecutionExtraContentModel,
)
from models.execution_extra_content import (
    HumanInputContent as HumanInputContentModel,
)
from models.human_input import HumanInputFormRecipient, RecipientType
from repositories.execution_extra_content_repository import ExecutionExtraContentRepository

logger = logging.getLogger(__name__)


class SQLAlchemyExecutionExtraContentRepository(ExecutionExtraContentRepository):
    def __init__(self, session_maker: sessionmaker[Session]):
        self._session_maker = session_maker

    @override
    def get_by_message_ids(self, message_ids: Sequence[str]) -> list[list[ExecutionExtraContentDomainModel]]:
        if not message_ids:
            return []

        grouped_contents: dict[str, list[ExecutionExtraContentDomainModel]] = {
            message_id: [] for message_id in message_ids
        }

        stmt = (
            select(ExecutionExtraContentModel)
            .where(ExecutionExtraContentModel.message_id.in_(message_ids))
            .options(selectinload(HumanInputContentModel.form))
            .order_by(ExecutionExtraContentModel.created_at.asc())
        )

        with self._session_maker() as session:
            results = session.scalars(stmt).all()

            form_ids = {
                content.form_id
                for content in results
                if isinstance(content, HumanInputContentModel) and content.form_id is not None
            }
            recipients_by_form_id: dict[str, list[HumanInputFormRecipient]] = defaultdict(list)
            if form_ids:
                recipient_stmt = select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids))
                recipients = session.scalars(recipient_stmt).all()
                for recipient in recipients:
                    recipients_by_form_id[recipient.form_id].append(recipient)
            else:
                recipients_by_form_id = {}

        for content in results:
            message_id = content.message_id
            if not message_id or message_id not in grouped_contents:
                continue

            domain_model = self._map_model_to_domain(content, recipients_by_form_id)
            if domain_model is None:
                continue

            grouped_contents[message_id].append(domain_model)

        return [grouped_contents[message_id] for message_id in message_ids]

    def _map_model_to_domain(
        self,
        model: ExecutionExtraContentModel,
        recipients_by_form_id: dict[str, list[HumanInputFormRecipient]],
    ) -> ExecutionExtraContentDomainModel | None:
        if isinstance(model, HumanInputContentModel):
            return self._map_human_input_content(model, recipients_by_form_id)

        logger.debug("Unsupported execution extra content type encountered: %s", model.type)
        return None

    def _map_human_input_content(
        self,
        model: HumanInputContentModel,
        recipients_by_form_id: dict[str, list[HumanInputFormRecipient]],
    ) -> HumanInputContentDomainModel | None:
        form = model.form
        if form is None:
            logger.warning("HumanInputContent(id=%s) has no associated form loaded", model.id)
            return None

        try:
            definition_payload = json.loads(form.form_definition)
            if "expiration_time" not in definition_payload:
                definition_payload["expiration_time"] = form.expiration_time
            form_definition = FormDefinition.model_validate(definition_payload)
        except ValueError:
            logger.warning("Failed to load form definition for HumanInputContent(id=%s)", model.id, exc_info=True)
            return None
        node_title = form_definition.node_title or form.node_id
        display_in_ui = bool(form_definition.display_in_ui)

        submitted = form.submitted_at is not None or form.status == HumanInputFormStatus.SUBMITTED
        if not submitted:
            form_token = self._resolve_form_token(recipients_by_form_id.get(form.id, []))
        else:
            form_token = None
        form_definition_domain_model = HumanInputFormDefinition(
            form_id=form.id,
            node_id=form.node_id,
            node_title=node_title,
            form_content=form.rendered_content,
            inputs=form_definition.inputs,
            actions=form_definition.user_actions,
            display_in_ui=display_in_ui,
            form_token=form_token,
            resolved_default_values=form_definition.default_values,
            expiration_time=int(form.expiration_time.timestamp()),
        )

        if not submitted:
            return HumanInputContentDomainModel(
                workflow_run_id=model.workflow_run_id,
                submitted=False,
                form_definition=form_definition_domain_model,
            )

        selected_action_id = form.selected_action_id
        if not selected_action_id:
            logger.warning("HumanInputContent(id=%s) form has no selected action", model.id)
            return None

        action_text = next(
            (action.title for action in form_definition.user_actions if action.id == selected_action_id),
            selected_action_id,
        )

        submitted_data: dict[str, Any] = {}
        if form.submitted_data:
            try:
                submitted_data = json.loads(form.submitted_data)
            except ValueError:
                logger.warning("Failed to load submitted data for HumanInputContent(id=%s)", model.id)
                return None

        rendered_content = render_form_content_with_outputs(
            form.rendered_content,
            submitted_data,
            extract_output_field_names(form_definition.form_content),
            form_definition.inputs,
        )

        return HumanInputContentDomainModel(
            workflow_run_id=model.workflow_run_id,
            submitted=submitted,
            form_definition=form_definition_domain_model,
            form_submission_data=HumanInputFormSubmissionData(
                node_id=form.node_id,
                node_title=node_title,
                rendered_content=rendered_content,
                action_id=selected_action_id,
                action_text=action_text,
                submitted_data=submitted_data,
            ),
        )

    @staticmethod
    def _resolve_form_token(recipients: Sequence[HumanInputFormRecipient]) -> str | None:
        console_recipient = next(
            (recipient for recipient in recipients if recipient.recipient_type == RecipientType.CONSOLE),
            None,
        )
        if console_recipient and console_recipient.access_token:
            return console_recipient.access_token

        web_app_recipient = next(
            (recipient for recipient in recipients if recipient.recipient_type == RecipientType.STANDALONE_WEB_APP),
            None,
        )
        if web_app_recipient and web_app_recipient.access_token:
            return web_app_recipient.access_token

        return None


__all__ = ["SQLAlchemyExecutionExtraContentRepository"]
