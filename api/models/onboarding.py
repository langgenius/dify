"""Account-level onboarding state models."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase, gen_uuidv7_string
from .types import AdjustedJSON, StringUUID


class AccountStepByStepTourState(TypeBase):
    """Persistent account-level Step-by-step Tour state.

    The tour is account-owned, with workspace IDs stored only as presentation
    overrides. The first workspace is the workspace context where an eligible
    account first asks for tour state; subsequent workspaces are opt-in only.
    """

    __tablename__ = "account_step_by_step_tour_states"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="account_step_by_step_tour_state_pkey"),
        sa.UniqueConstraint("account_id", name="account_step_by_step_tour_state_account_id_key"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        insert_default=gen_uuidv7_string,
        default_factory=gen_uuidv7_string,
        init=False,
    )
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    first_workspace_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    skipped: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    completed_task_ids: Mapped[list[str]] = mapped_column(AdjustedJSON, nullable=False, default_factory=list)
    manually_enabled_workspace_ids: Mapped[list[str]] = mapped_column(
        AdjustedJSON,
        nullable=False,
        default_factory=list,
    )
    manually_disabled_workspace_ids: Mapped[list[str]] = mapped_column(
        AdjustedJSON,
        nullable=False,
        default_factory=list,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
        init=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
        init=False,
        onupdate=func.current_timestamp(),
    )
