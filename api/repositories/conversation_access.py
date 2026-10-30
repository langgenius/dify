"""Current conversation ownership authorizes history; original senders remain provenance."""

import sqlalchemy as sa
from sqlalchemy.orm import Session

from models.account import Account
from models.enums import AppStatus, ConversationFromSource
from models.model import App, Conversation, EndUser, Message
from repositories.end_user_execution_lock import lock_end_user


class ConversationAccessDeniedError(LookupError):
    pass


def conversation_actor_scope(
    app_id: str, *, end_user_id: str | None, account_id: str | None
) -> tuple[sa.ColumnElement[bool], ...]:
    if (end_user_id is None) == (account_id is None):
        return (sa.false(),)
    return (
        Conversation.app_id == app_id,
        Conversation.is_deleted.is_(False),
        Conversation.from_source
        == (ConversationFromSource.API if end_user_id is not None else ConversationFromSource.CONSOLE),
        Conversation.from_end_user_id == end_user_id
        if end_user_id is not None
        else Conversation.from_end_user_id.is_(None),
        Conversation.from_account_id == account_id
        if account_id is not None
        else Conversation.from_account_id.is_(None),
    )


def conversation_owner_scope(app_id: str, user: Account | EndUser | None) -> tuple[sa.ColumnElement[bool], ...]:
    return conversation_actor_scope(
        app_id,
        end_user_id=user.id if isinstance(user, EndUser) else None,
        account_id=user.id if isinstance(user, Account) else None,
    )


def message_actor_scope(app_id: str, *, end_user_id: str | None, account_id: str | None) -> sa.ColumnElement[bool]:
    return sa.and_(
        Message.app_id == app_id,
        sa.exists(
            sa.select(Conversation.id).where(
                Conversation.id == Message.conversation_id,
                *conversation_actor_scope(app_id, end_user_id=end_user_id, account_id=account_id),
            )
        ).correlate(Message),
    )


def message_owner_scope(app_id: str, user: Account | EndUser | None) -> sa.ColumnElement[bool]:
    return sa.and_(
        Message.app_id == app_id,
        sa.exists(
            sa.select(Conversation.id).where(
                Conversation.id == Message.conversation_id, *conversation_owner_scope(app_id, user)
            )
        ).correlate(Message),
    )


def lock_web_message_acceptance(
    session: Session, *, tenant_id: str, app_id: str, end_user_id: str, conversation_id: str | None
) -> EndUser:
    """Serialize acceptance with migration before creating a message, without provider I/O."""
    app = session.scalar(
        sa.select(App.id).where(
            App.id == app_id, App.tenant_id == tenant_id, App.status == AppStatus.NORMAL, App.enable_site.is_(True)
        )
    )
    actor = lock_end_user(session, tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id, exclusive=False)
    if app is None or actor is None:
        raise ConversationAccessDeniedError("Conversation ownership changed")
    if (
        conversation_id is not None
        and session.scalar(
            sa.select(Conversation.id)
            .where(Conversation.id == conversation_id, *conversation_owner_scope(app_id, actor))
            .with_for_update()
        )
        is None
    ):
        raise ConversationAccessDeniedError("Conversation ownership changed")
    return actor


def may_read_conversation_run(
    session: Session, *, app_id: str, user: EndUser, run_id: str, original_end_user_id: str
) -> bool:
    """Attached Runs follow the conversation; standalone Runs retain their original owner."""
    messages = sa.select(Message.id).where(Message.app_id == app_id, Message.workflow_run_id == run_id)
    if session.scalar(sa.select(sa.exists(messages))):
        return bool(session.scalar(sa.select(sa.exists(messages.where(message_owner_scope(app_id, user))))))
    return original_end_user_id == user.id


def original_run_creator(session: Session, *, tenant_id: str, app_id: str, end_user_id: str) -> EndUser | None:
    return session.scalar(
        sa.select(EndUser).where(EndUser.id == end_user_id, EndUser.app_id == app_id, EndUser.tenant_id == tenant_id)
    )
