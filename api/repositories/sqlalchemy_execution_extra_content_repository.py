from __future__ import annotations

import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.entities.execution_extra_content import (
    ExecutionExtraContentDomainModel,
)
from core.entities.execution_extra_content import (
    HumanInputContent as HumanInputContentDomainModel,
)
from core.workflow.nodes.human_input.entities import FormDefinition
from models.execution_extra_content import (
    ExecutionExtraContent as ExecutionExtraContentModel,
)
from models.execution_extra_content import (
    HumanInputContent as HumanInputContentModel,
)
from repositories.execution_extra_content_repository import ExecutionExtraContentRepository

logger = logging.getLogger(__name__)


class SQLAlchemyExecutionExtraContentRepository(ExecutionExtraContentRepository):
    def __init__(self, session_maker: sessionmaker[Session]):
        self._session_maker = session_maker

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

        for content in results:
            message_id = content.message_id
            if not message_id or message_id not in grouped_contents:
                continue

            domain_model = self._map_model_to_domain(content)
            if domain_model is None:
                continue

            grouped_contents[message_id].append(domain_model)

        return [grouped_contents[message_id] for message_id in message_ids]

    def _map_model_to_domain(self, model: ExecutionExtraContentModel) -> ExecutionExtraContentDomainModel | None:
        if isinstance(model, HumanInputContentModel):
            return self._map_human_input_content(model)

        logger.debug("Unsupported execution extra content type encountered: %s", model.type)
        return None

    def _map_human_input_content(self, model: HumanInputContentModel) -> HumanInputContentDomainModel | None:
        form = model.form
        if form is None:
            logger.warning("HumanInputContent(id=%s) has no associated form loaded", model.id)
            return None

        selected_action_id = form.selected_action_id
        if not selected_action_id:
            logger.warning("HumanInputContent(id=%s) form has no selected action", model.id)
            return None

        try:
            form_definition = FormDefinition.model_validate_json(form.form_definition)
        except ValueError:
            logger.warning("Failed to load form definition for HumanInputContent(id=%s)", model.id)
            return None

        action_text = next(
            (action.title for action in form_definition.user_actions if action.id == selected_action_id),
            selected_action_id,
        )

        return HumanInputContentDomainModel(
            action_id=selected_action_id,
            action_text=action_text,
            rendered_content=form.rendered_content,
        )


__all__ = ["SQLAlchemyExecutionExtraContentRepository"]
