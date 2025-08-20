from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .types import StringUUID


class ChatflowMemoryVariable(Base):
    __tablename__ = "chatflow_memory_variables"

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    node_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    memory_id: Mapped[str] = mapped_column(sa.Text, nullable=False)
    value: Mapped[str] = mapped_column(sa.Text, nullable=False)
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    scope: Mapped[str] = mapped_column(sa.String(10), nullable=False)  # 'app' or 'node'
    term: Mapped[str] = mapped_column(sa.String(20), nullable=False)  # 'session' or 'persistent'

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )


class ChatflowConversation(Base):
    __tablename__ = "chatflow_conversations"

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    original_conversation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    conversation_metadata: Mapped[str] = mapped_column(sa.Text, nullable=False)  # JSON

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )


class ChatflowMessage(Base):
    __tablename__ = "chatflow_messages"

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, server_default=sa.text("uuid_generate_v4()"))
    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    index: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    data: Mapped[str] = mapped_column(sa.Text, nullable=False)  # Serialized PromptMessage JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
