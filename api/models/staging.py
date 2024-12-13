from datetime import datetime

from sqlalchemy.orm import Mapped

from extensions.ext_database import db
from models.base import Base

from .types import StringUUID


class StagingAccountWhitelist(Base):
    __tablename__ = "staging_account_whitelists"

    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="staging_account_whitelist_pkey"),
        db.Index("account_email_idx", "email"),
    )

    id: Mapped[str] = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    email: Mapped[str] = db.Column(db.String(255), nullable=False)
    disabled: Mapped[bool] = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    created_at: Mapped[datetime] = db.Column(
        db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)")
    )
    updated_at: Mapped[datetime] = db.Column(
        db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)")
    )
