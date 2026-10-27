from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.model import App, EndUser
from models.web import PinnedConversation
from services.conversation_service import ConversationService


class WebConversationService:
    @classmethod
    def pagination_by_last_id(
        cls,
        *,
        session: Session,
        app_model: App,
        user: Account | EndUser | None,
        last_id: str | None,
        limit: int,
        invoke_from: InvokeFrom,
        pinned: bool | None = None,
        sort_by="-updated_at",
    ) -> InfiniteScrollPagination:
        if not user:
            raise ValueError("User is required")
        include_ids = None
        exclude_ids = None
        if pinned is not None and user:
            stmt = (
                select(PinnedConversation.conversation_id)
                .where(
                    PinnedConversation.app_id == app_model.id,
                    PinnedConversation.created_by_role == ("account" if isinstance(user, Account) else "end_user"),
                    PinnedConversation.created_by == user.id,
                )
                .order_by(PinnedConversation.created_at.desc())
            )
            pinned_conversation_ids = session.scalars(stmt).all()

            if pinned:
                include_ids = pinned_conversation_ids
            else:
                exclude_ids = pinned_conversation_ids

        return ConversationService.pagination_by_last_id(
            session=session,
            app_model=app_model,
            user=user,
            last_id=last_id,
            limit=limit,
            invoke_from=invoke_from,
            include_ids=include_ids,
            exclude_ids=exclude_ids,
            sort_by=sort_by,
        )
