from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self, final

import sqlalchemy as sa
from pydantic import BaseModel, Field
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.workflow.nodes.human_input.enums import (
    DeliveryMethodType,
    HumanInputFormKind,
    HumanInputFormStatus,
)
from libs.helper import generate_string

from .base import Base, DefaultFieldsMixin
from .types import EnumText, StringUUID

_token_length = 22
# A 32-character string can store a base64-encoded value with 192 bits of entropy
# or a base62-encoded value with over 180 bits of entropy, providing sufficient
# uniqueness for most use cases.
_token_field_length = 32
_email_field_length = 330


def _generate_token() -> str:
    return generate_string(_token_length)


class HumanInputForm(DefaultFieldsMixin, Base):
    __tablename__ = "human_input_forms"

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    form_kind: Mapped[HumanInputFormKind] = mapped_column(
        EnumText(HumanInputFormKind),
        nullable=False,
        default=HumanInputFormKind.RUNTIME,
    )

    # The human input node the current form corresponds to.
    node_id: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    form_definition: Mapped[str] = mapped_column(sa.Text, nullable=False)
    rendered_content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    status: Mapped[HumanInputFormStatus] = mapped_column(
        EnumText(HumanInputFormStatus),
        nullable=False,
        default=HumanInputFormStatus.WAITING,
    )

    expiration_time: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
    )

    # Submission-related fields (nullable until a submission happens).
    selected_action_id: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    submitted_data: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True)
    submission_user_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    submission_end_user_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    completed_by_recipient_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
    )

    deliveries: Mapped[list["HumanInputDelivery"]] = relationship(
        "HumanInputDelivery",
        primaryjoin="HumanInputForm.id ==  foreign(HumanInputDelivery.form_id)",
        uselist=True,
        back_populates="form",
        lazy="raise",
    )
    completed_by_recipient: Mapped["HumanInputFormRecipient | None"] = relationship(
        "HumanInputFormRecipient",
        primaryjoin="HumanInputForm.completed_by_recipient_id == foreign(HumanInputFormRecipient.id)",
        lazy="raise",
        viewonly=True,
    )


class HumanInputDelivery(DefaultFieldsMixin, Base):
    __tablename__ = "human_input_form_deliveries"

    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )
    delivery_method_type: Mapped[DeliveryMethodType] = mapped_column(
        EnumText(DeliveryMethodType),
        nullable=False,
    )
    delivery_config_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    channel_payload: Mapped[str] = mapped_column(sa.Text, nullable=False)

    form: Mapped[HumanInputForm] = relationship(
        "HumanInputForm",
        uselist=False,
        foreign_keys=[form_id],
        primaryjoin="HumanInputDelivery.form_id == HumanInputForm.id",
        back_populates="deliveries",
        lazy="raise",
    )

    recipients: Mapped[list["HumanInputFormRecipient"]] = relationship(
        "HumanInputFormRecipient",
        primaryjoin="HumanInputDelivery.id == foreign(HumanInputFormRecipient.delivery_id)",
        uselist=True,
        back_populates="delivery",
        # Require explicit preloading
        lazy="raise",
    )


class RecipientType(StrEnum):
    # EMAIL_MEMBER member means that the
    EMAIL_MEMBER = "email_member"
    EMAIL_EXTERNAL = "email_external"
    # STANDALONE_WEB_APP is used by the standalone web app.
    #
    # It's not used while running workflows / chatflows containing HumanInput
    # node inside console.
    STANDALONE_WEB_APP = "standalone_web_app"
    # CONSOLE is used while running workflows / chatflows containing HumanInput
    # node inside console. (E.G. running installed apps or debugging workflows / chatflows)
    CONSOLE = "console"
    # BACKSTAGE is used for backstage input inside console.
    BACKSTAGE = "backstage"


@final
class EmailMemberRecipientPayload(BaseModel):
    TYPE: Literal[RecipientType.EMAIL_MEMBER] = RecipientType.EMAIL_MEMBER
    user_id: str

    # The `email` field here is only used for mail sending.
    email: str


@final
class EmailExternalRecipientPayload(BaseModel):
    TYPE: Literal[RecipientType.EMAIL_EXTERNAL] = RecipientType.EMAIL_EXTERNAL
    email: str


@final
class StandaloneWebAppRecipientPayload(BaseModel):
    TYPE: Literal[RecipientType.STANDALONE_WEB_APP] = RecipientType.STANDALONE_WEB_APP


@final
class ConsoleRecipientPayload(BaseModel):
    TYPE: Literal[RecipientType.CONSOLE] = RecipientType.CONSOLE
    account_id: str | None = None


@final
class BackstageRecipientPayload(BaseModel):
    TYPE: Literal[RecipientType.BACKSTAGE] = RecipientType.BACKSTAGE
    account_id: str | None = None


@final
class ConsoleDeliveryPayload(BaseModel):
    type: Literal["console"] = "console"
    internal: bool = True


RecipientPayload = Annotated[
    EmailMemberRecipientPayload
    | EmailExternalRecipientPayload
    | StandaloneWebAppRecipientPayload
    | ConsoleRecipientPayload
    | BackstageRecipientPayload,
    Field(discriminator="TYPE"),
]


class HumanInputFormRecipient(DefaultFieldsMixin, Base):
    __tablename__ = "human_input_form_recipients"

    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )
    delivery_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )
    recipient_type: Mapped["RecipientType"] = mapped_column(EnumText(RecipientType), nullable=False)
    recipient_payload: Mapped[str] = mapped_column(sa.Text, nullable=False)

    # Token primarily used for authenticated resume links (email, etc.).
    access_token: Mapped[str | None] = mapped_column(
        sa.VARCHAR(_token_field_length),
        nullable=False,
        default=_generate_token,
        unique=True,
    )

    delivery: Mapped[HumanInputDelivery] = relationship(
        "HumanInputDelivery",
        uselist=False,
        foreign_keys=[delivery_id],
        back_populates="recipients",
        primaryjoin="HumanInputFormRecipient.delivery_id == HumanInputDelivery.id",
        # Require explicit preloading
        lazy="raise",
    )

    form: Mapped[HumanInputForm] = relationship(
        "HumanInputForm",
        uselist=False,
        foreign_keys=[form_id],
        primaryjoin="HumanInputFormRecipient.form_id == HumanInputForm.id",
        # Require explicit preloading
        lazy="raise",
    )

    @classmethod
    def new(
        cls,
        form_id: str,
        delivery_id: str,
        payload: RecipientPayload,
    ) -> Self:
        recipient_model = cls(
            form_id=form_id,
            delivery_id=delivery_id,
            recipient_type=payload.TYPE,
            recipient_payload=payload.model_dump_json(),
            access_token=_generate_token(),
        )
        return recipient_model
