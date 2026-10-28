"""Bind execution-local grants for files retained in owned conversation history."""

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import replace

from core.app.file_access.scope import FileAccessScope, bind_file_access_scope
from core.db.session_factory import session_factory
from models.account import Account
from models.model import Conversation, EndUser
from repositories.conversation_file_access import conversation_file_grants


@contextmanager
def bind_conversation_file_scope(
    scope: FileAccessScope, *, conversation: Conversation | None, user: Account | EndUser
) -> Generator[None]:
    if conversation is not None and scope.requires_user_ownership:
        with session_factory.create_session() as session:
            grants = conversation_file_grants(
                session,
                tenant_id=scope.tenant_id,
                app_id=conversation.app_id,
                conversation_id=conversation.id,
                user=user,
            )
        scope = replace(
            scope,
            granted_upload_file_ids=scope.granted_upload_file_ids | grants.uploads,
            granted_tool_file_ids=scope.granted_tool_file_ids | grants.tools,
        )
    with bind_file_access_scope(scope):
        yield
