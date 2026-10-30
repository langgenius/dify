"""One current Workspace cognition policy; unrelated tenant branding is untouched."""

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import TypeBase
from models.types import StringUUID


class DifyBuilderCognitionPolicy(TypeBase):
    __tablename__ = "dify_builder_cognition_policies"
    __table_args__ = (sa.CheckConstraint("revision > 0", name="builder_cognition_policy_revision"),)

    tenant_id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    revision: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    policy: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    updated_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
