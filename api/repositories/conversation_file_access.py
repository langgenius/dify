"""Grant only persisted history references from a currently authorized conversation."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.workflow.file_reference import resolve_file_record_id
from models.account import Account
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType
from models.model import App, Conversation, EndUser, Message, MessageFile, UploadFile
from models.tools import ToolFile
from models.workflow import ConversationVariable
from repositories.conversation_access import conversation_owner_scope


@dataclass(frozen=True)
class ConversationFileGrants:
    uploads: frozenset[str]
    tools: frozenset[str]


def lock_conversation_file_owner(session: Session, *, tenant_id: str, user_id: str, conversation_id: str | None) -> str:
    """Late files from accepted Guest messages follow the current conversation owner.

    Keep the parent lock until insertion commits, so migration either includes
    the new file or finishes first and supplies its new owner. Callers perform
    storage and provider I/O before entering this transaction.
    """
    if conversation_id is None:
        return user_id
    original = session.scalar(
        sa.select(EndUser).where(
            EndUser.id == user_id,
            EndUser.tenant_id == tenant_id,
            EndUser.type == EndUserType.BROWSER,
            EndUser.account_id.is_(None),
        )
    )
    if original is None:
        return user_id
    conversation = session.scalar(
        sa.select(Conversation)
        .join(App, App.id == Conversation.app_id)
        .where(
            App.tenant_id == tenant_id,
            Conversation.app_id == original.app_id,
            Conversation.id == conversation_id,
            Conversation.from_source == ConversationFromSource.API,
            Conversation.from_account_id.is_(None),
        )
        .with_for_update(of=Conversation)
    )
    if conversation is None or conversation.from_end_user_id == user_id:
        return user_id
    target = session.scalar(
        sa.select(EndUser.id).where(
            EndUser.id == conversation.from_end_user_id,
            EndUser.app_id == original.app_id,
            EndUser.tenant_id == tenant_id,
            EndUser.type == EndUserType.BROWSER,
            EndUser.account_id.is_not(None),
            sa.exists(
                sa.select(Message.id).where(
                    Message.app_id == original.app_id,
                    Message.conversation_id == conversation_id,
                    Message.from_source == ConversationFromSource.API,
                    Message.from_end_user_id == user_id,
                    Message.from_account_id.is_(None),
                )
            ),
        )
    )
    return target or user_id


def message_file_conversation_id(session: Session, *, tenant_id: str, message_id: str, user_id: str) -> str | None:
    return session.scalar(
        sa.select(Message.conversation_id)
        .join(App, App.id == Message.app_id)
        .where(
            App.tenant_id == tenant_id,
            Message.id == message_id,
            sa.or_(Message.from_end_user_id == user_id, Message.from_account_id == user_id),
        )
    )


def _file_references(value: object, uploads: set[str], tools: set[str]) -> None:
    if isinstance(value, Mapping):
        method = value.get("transfer_method")
        if isinstance(method, str) and method in {"local_file", "remote_url", "tool_file", "datasource_file"}:
            reference = next(
                (
                    value.get(key)
                    for key in ("upload_file_id", "tool_file_id", "datasource_file_id", "reference", "related_id")
                    if isinstance(value.get(key), str) and value.get(key)
                ),
                None,
            )
            if isinstance(reference, str):
                try:
                    record_id = resolve_file_record_id(reference)
                    if not isinstance(record_id, str):
                        raise ValueError("Missing file record")
                    UUID(record_id)
                except (ValueError, TypeError):
                    pass
                else:
                    (tools if method == "tool_file" else uploads).add(record_id)
        for item in value.values():
            _file_references(item, uploads, tools)
    elif isinstance(value, list):
        for item in value:
            _file_references(item, uploads, tools)


def conversation_file_grants(
    session: Session, *, tenant_id: str, app_id: str, conversation_id: str, user: Account | EndUser
) -> ConversationFileGrants:
    conversation = session.scalar(
        sa.select(Conversation)
        .join(App, App.id == Conversation.app_id)
        .where(App.tenant_id == tenant_id, Conversation.id == conversation_id, *conversation_owner_scope(app_id, user))
    )
    if conversation is None:
        return ConversationFileGrants(frozenset(), frozenset())
    uploads: set[str] = set()
    tools: set[str] = set()
    linked_uploads: set[str] = set()
    linked_tools: set[str] = set()
    senders = {user.id}
    _file_references(conversation._inputs, uploads, tools)
    messages = session.execute(
        sa.select(Message.id, Message.from_end_user_id, Message._inputs).where(
            Message.app_id == app_id,
            Message.conversation_id == conversation_id,
        )
    ).all()
    for _message_id, sender, inputs in messages:
        if sender:
            senders.add(sender)
        _file_references(inputs, uploads, tools)
    for file in session.execute(
        sa.select(MessageFile.upload_file_id, MessageFile.transfer_method)
        .join(Message, Message.id == MessageFile.message_id)
        .where(Message.app_id == app_id, Message.conversation_id == conversation_id)
    ):
        if file.upload_file_id:
            (linked_tools if file.transfer_method == "tool_file" else linked_uploads).add(file.upload_file_id)
    for data in session.scalars(
        sa.select(ConversationVariable.data).where(
            ConversationVariable.app_id == app_id, ConversationVariable.conversation_id == conversation_id
        )
    ):
        try:
            _file_references(json.loads(data), uploads, tools)
        except (ValueError, TypeError):
            continue
    visible = sa.exists(
        sa.select(Conversation.id)
        .join(App, App.id == Conversation.app_id)
        .where(App.tenant_id == tenant_id, Conversation.id == conversation_id, *conversation_owner_scope(app_id, user))
    )
    upload_ids = session.scalars(
        sa.select(UploadFile.id).where(
            visible,
            UploadFile.tenant_id == tenant_id,
            UploadFile.id.in_(uploads | linked_uploads),
            sa.or_(
                sa.and_(UploadFile.created_by_role == CreatorUserRole.END_USER, UploadFile.created_by.in_(senders)),
                UploadFile.id.in_(linked_uploads),
            ),
        )
    ).all()
    tool_ids = session.scalars(
        sa.select(ToolFile.id).where(
            visible,
            ToolFile.tenant_id == tenant_id,
            ToolFile.id.in_(tools | linked_tools),
            sa.or_(ToolFile.user_id.in_(senders), ToolFile.id.in_(linked_tools)),
        )
    ).all()
    return ConversationFileGrants(frozenset(upload_ids), frozenset(tool_ids))
