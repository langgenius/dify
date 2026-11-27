"""Current conversation ownership authorizes history; original senders remain provenance."""

import sqlalchemy as sa
from sqlalchemy.orm import Session, aliased

from models.account import Account
from models.enums import AppStatus, ConversationFromSource, InvokeFrom
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


def message_sender_scope(app_id: str, *, end_user_id: str | None, account_id: str | None) -> sa.ColumnElement[bool]:
    """Match the full sender of a message in the admitted app; ambiguous actor IDs match nothing."""
    if (end_user_id is None) == (account_id is None):
        return sa.false()
    source = ConversationFromSource.API if end_user_id is not None else ConversationFromSource.CONSOLE
    return sa.and_(
        Message.app_id == app_id,
        Message.from_source == source,
        Message.from_end_user_id == end_user_id,
        Message.from_account_id == account_id,
    )


def _web_guest_identity_pair(
    app_id: str, *, end_user_id: str, guest_id: str | sa.SQLColumnExpression[str | None]
) -> sa.ColumnElement[bool]:
    """Match a mapped Web owner and a guest identity in their app and tenant."""
    guest = aliased(EndUser)
    return sa.exists(
        sa.select(EndUser.id)
        .join(guest, sa.and_(guest.app_id == EndUser.app_id, guest.tenant_id == EndUser.tenant_id))
        .where(
            EndUser.id == end_user_id,
            EndUser.app_id == app_id,
            EndUser.account_id.is_not(None),
            guest.id == guest_id,
            guest.account_id.is_(None),
        )
    ).correlate(Message)


def _web_conversation_origin() -> sa.ColumnElement[bool]:
    """Recognize Web conversations, including rows from before invocation origins were persisted."""
    return sa.or_(Conversation.invoke_from == InvokeFrom.WEB_APP, Conversation.invoke_from.is_(None))


def _web_guest_provenance(app_id: str, *, end_user_id: str) -> sa.ColumnElement[bool]:
    """Match guest provenance inside a Web conversation query correlated to a message."""
    return sa.and_(
        Message.from_source == ConversationFromSource.API,
        Message.from_account_id.is_(None),
        _web_conversation_origin(),
        _web_guest_identity_pair(app_id, end_user_id=end_user_id, guest_id=Message.from_end_user_id),
    )


def _message_in_owned_conversation(
    app_id: str, *, end_user_id: str | None, account_id: str | None, provenance: sa.ColumnElement[bool]
) -> sa.ColumnElement[bool]:
    """Combine the admitted actor, live conversation, and caller-specific provenance."""
    # Keep the app/run predicates on the outer query so provenance cannot displace its index lookup.
    return sa.and_(
        Message.app_id == app_id,
        sa.exists(
            sa.select(Conversation.id).where(
                Conversation.id == Message.conversation_id,
                *conversation_actor_scope(app_id, end_user_id=end_user_id, account_id=account_id),
                provenance,
            )
        ).correlate(Message),
    )


def transferred_web_message_scope(app_id: str, *, end_user_id: str) -> sa.ColumnElement[bool]:
    """Match a live conversation now owned by the admitted Web account, with its original guest sender."""
    return _message_in_owned_conversation(
        app_id,
        end_user_id=end_user_id,
        account_id=None,
        provenance=_web_guest_provenance(app_id, end_user_id=end_user_id),
    )


def message_actor_scope(app_id: str, *, end_user_id: str | None, account_id: str | None) -> sa.ColumnElement[bool]:
    """Require current conversation ownership and matching sender or validated Web guest provenance."""
    sender = message_sender_scope(app_id, end_user_id=end_user_id, account_id=account_id)
    provenance = (
        sa.or_(sender, _web_guest_provenance(app_id, end_user_id=end_user_id))
        if end_user_id is not None and account_id is None
        else sender
    )
    return _message_in_owned_conversation(app_id, end_user_id=end_user_id, account_id=account_id, provenance=provenance)


def message_owner_scope(app_id: str, user: Account | EndUser | None) -> sa.ColumnElement[bool]:
    return message_actor_scope(
        app_id,
        end_user_id=user.id if isinstance(user, EndUser) else None,
        account_id=user.id if isinstance(user, Account) else None,
    )


def require_web_message_access(
    session: Session, *, tenant_id: str, app_id: str, end_user_id: str, conversation_id: str | None
) -> None:
    """Authorize the original Web actor while fencing migration until commit or rollback.

    Call before accessing conversation data in a short caller-owned transaction.
    The identity lock precedes snapshot reads, including on MySQL. Missing or
    transferred resources raise ConversationAccessDeniedError without mutation.
    """
    actor = lock_end_user(session, tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id, exclusive=False)
    app = session.scalar(
        sa.select(App.id).where(
            App.id == app_id, App.tenant_id == tenant_id, App.status == AppStatus.NORMAL, App.enable_site.is_(True)
        )
    )
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


def require_web_message_owner(
    session: Session, *, tenant_id: str, app_id: str, end_user_id: str, message_id: str
) -> None:
    """Fence a message write using its current conversation and original caller.

    The caller commits or rolls back the transaction before external I/O. A
    missing message or changed owner raises without granting a replacement actor.
    """
    require_web_message_access(
        session, tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id, conversation_id=None
    )
    conversation_id = session.scalar(
        sa.select(Message.conversation_id).where(
            Message.id == message_id, message_actor_scope(app_id, end_user_id=end_user_id, account_id=None)
        )
    )
    if conversation_id is None:
        raise ConversationAccessDeniedError("Conversation ownership changed")
    require_web_message_access(
        session, tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id, conversation_id=conversation_id
    )


def may_read_conversation_run(
    session: Session, *, app_id: str, user: EndUser, run_id: str, original_end_user_id: str
) -> bool:
    """Authorize an admitted Web actor using a persisted run's creator and current conversation owner.

    Attached runs follow their live Web conversation only when the creator is
    the same actor or a guest in that app. Standalone runs retain their creator.
    """
    if user.app_id != app_id:
        return False
    messages = sa.select(Message.id).where(Message.app_id == app_id, Message.workflow_run_id == run_id)
    if session.scalar(sa.select(sa.exists(messages))):
        provenance = (
            sa.true()
            if original_end_user_id == user.id
            else sa.and_(
                _web_conversation_origin(),
                _web_guest_identity_pair(app_id, end_user_id=user.id, guest_id=original_end_user_id),
            )
        )
        return bool(
            session.scalar(
                sa.select(
                    sa.exists(
                        messages.where(
                            _message_in_owned_conversation(
                                app_id, end_user_id=user.id, account_id=None, provenance=provenance
                            )
                        )
                    )
                )
            )
        )
    return original_end_user_id == user.id


def original_run_creator(session: Session, *, tenant_id: str, app_id: str, end_user_id: str) -> EndUser | None:
    return session.scalar(
        sa.select(EndUser).where(EndUser.id == end_user_id, EndUser.app_id == app_id, EndUser.tenant_id == tenant_id)
    )
