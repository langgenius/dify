"""Builder-owned upload associations and ordered supplemental intake receipts."""

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7
from models.base import TypeBase
from models.dify_builder import BuilderRowIdentity
from models.types import AdjustedJSON, LongText, StringUUID


class DifyBuilderMaterial(BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_material"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_material_pkey"),
        sa.UniqueConstraint("session_id", "client_turn_id", name="builder_material_turn_unique"),
        sa.UniqueConstraint("session_id", "seq", name="builder_material_seq_unique"),
        sa.Index("builder_material_owner_idx", "tenant_id", "owner_account_id", "app_id", "session_id"),
    )
    id: Mapped[str] = mapped_column(StringUUID, insert_default=lambda: str(uuidv7()), default=None)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    task_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    generation: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    seq: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    client_turn_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    input_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    text: Mapped[str] = mapped_column(LongText, nullable=False)
    uploads: Mapped[list] = mapped_column(AdjustedJSON, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    test_candidate: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    consumed_version: Mapped[int | None] = mapped_column(sa.Integer, nullable=True, default=None)
