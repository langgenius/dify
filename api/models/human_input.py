from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self, final

import sqlalchemy as sa
from pydantic import BaseModel, Field
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.workflow.human_input_adapter import DeliveryMethodType
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.helper import generate_string

from .base import Base, DefaultFieldsDCMixin, DefaultFieldsMixin, TypeBase
from .types import EnumText, StringUUID

_token_length = 22
# A 32-character string can store a base64-encoded value with 192 bits of entropy
# or a base62-encoded value with over 180 bits of entropy, providing sufficient
# uniqueness for most use cases.
_token_field_length = 32
_email_field_length = 330


def _generate_token() -> str:
    return generate_string(_token_length)


class HumanInputForm(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "human_input_forms"
    __table_args__ = (
        sa.Index(
            "human_input_forms_workflow_run_id_node_id_idx",
            "workflow_run_id",
            "node_id",
        ),
        sa.Index("human_input_forms_status_expiration_time_idx", "status", "expiration_time"),
        sa.Index("human_input_forms_status_created_at_idx", "status", "created_at"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # The human input node the current form corresponds to.
    node_id: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    form_definition: Mapped[str] = mapped_column(sa.Text, nullable=False)
    rendered_content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    expiration_time: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
    )

    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    # ENG-635: a RUNTIME form is tagged with its owning workflow run and/or its
    # conversation. Workflow / Human-Input / agent-node forms always set
    # workflow_run_id, and ALSO set conversation_id when the run has a conversation
    # (chatflow / advanced-chat). Agent v2 chat ask_human forms set only
    # conversation_id (the new Agent App has no workflow_run_id). At least one is set;
    # resume routing prefers workflow_run_id when both are present.
    conversation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    form_kind: Mapped[HumanInputFormKind] = mapped_column(
        EnumText(HumanInputFormKind),
        nullable=False,
        default=HumanInputFormKind.RUNTIME,
    )
    status: Mapped[HumanInputFormStatus] = mapped_column(
        EnumText(HumanInputFormStatus),
        nullable=False,
        default=HumanInputFormStatus.WAITING,
    )

    # Submission-related fields (nullable until a submission happens).
    selected_action_id: Mapped[str | None] = mapped_column(sa.String(200), nullable=True, default=None)
    submitted_data: Mapped[str | None] = mapped_column(sa.Text, nullable=True, default=None)
    submitted_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    submission_user_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    submission_end_user_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)

    completed_by_recipient_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
    )

    deliveries: Mapped[list["HumanInputDelivery"]] = relationship(
        "HumanInputDelivery",
        primaryjoin="HumanInputForm.id ==  foreign(HumanInputDelivery.form_id)",
        uselist=True,
        back_populates="form",
        lazy="raise",
        init=False,
    )
    completed_by_recipient: Mapped["HumanInputFormRecipient | None"] = relationship(
        "HumanInputFormRecipient",
        primaryjoin="HumanInputForm.completed_by_recipient_id == foreign(HumanInputFormRecipient.id)",
        lazy="raise",
        viewonly=True,
        init=False,
    )


class HumanInputDelivery(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "human_input_form_deliveries"
    __table_args__ = (
        sa.Index(
            None,
            "form_id",
        ),
    )

    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )
    delivery_method_type: Mapped[DeliveryMethodType] = mapped_column(
        EnumText(DeliveryMethodType),
        nullable=False,
    )
    channel_payload: Mapped[str] = mapped_column(sa.Text, nullable=False)
    delivery_config_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)

    form: Mapped[HumanInputForm] = relationship(
        "HumanInputForm",
        uselist=False,
        foreign_keys=[form_id],
        primaryjoin="HumanInputDelivery.form_id == HumanInputForm.id",
        back_populates="deliveries",
        lazy="raise",
        init=False,
    )

    recipients: Mapped[list["HumanInputFormRecipient"]] = relationship(
        "HumanInputFormRecipient",
        primaryjoin="HumanInputDelivery.id == foreign(HumanInputFormRecipient.delivery_id)",
        uselist=True,
        back_populates="delivery",
        # Require explicit preloading
        lazy="raise",
        init=False,
    )


class ApprovalChannel(StrEnum):
    """Where a paused human input form can be approved, surfaced to API callers."""

    EMAIL = "email"
    WEB_APP = "web_app"
    CONSOLE = "console"


class RecipientType(StrEnum):
    # Second value = the approval channel this recipient maps to (surfaced in `approval_channels`).
    EMAIL_MEMBER = "email_member", ApprovalChannel.EMAIL
    EMAIL_EXTERNAL = "email_external", ApprovalChannel.EMAIL
    # STANDALONE_WEB_APP is used by the standalone web app.
    #
    # It's not used while running workflows / chatflows containing HumanInput
    # node inside console.
    STANDALONE_WEB_APP = "standalone_web_app", ApprovalChannel.WEB_APP
    # CONSOLE is used while running workflows / chatflows containing HumanInput
    # node inside console. (E.G. running installed apps or debugging workflows / chatflows)
    CONSOLE = "console", ApprovalChannel.CONSOLE
    # BACKSTAGE is used for backstage input inside console.
    BACKSTAGE = "backstage", ApprovalChannel.CONSOLE

    _approval_channel: ApprovalChannel

    def __new__(cls, value: str, approval_channel: ApprovalChannel) -> "RecipientType":
        member = str.__new__(cls, value)
        member._value_ = value
        member._approval_channel = approval_channel
        return member

    @property
    def approval_channel(self) -> ApprovalChannel:
        return self._approval_channel


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


class HumanInputFormRecipient(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "human_input_form_recipients"
    __table_args__ = (
        sa.Index(None, "form_id"),
        sa.Index(None, "delivery_id"),
    )

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
    access_token: Mapped[str] = mapped_column(
        sa.VARCHAR(_token_field_length),
        nullable=False,
        insert_default=_generate_token,
        default_factory=_generate_token,
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
        init=False,
    )

    form: Mapped[HumanInputForm] = relationship(
        "HumanInputForm",
        uselist=False,
        foreign_keys=[form_id],
        primaryjoin="HumanInputFormRecipient.form_id == HumanInputForm.id",
        # Require explicit preloading
        lazy="raise",
        init=False,
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


class HumanInputFormUploadToken(DefaultFieldsMixin, Base):
    """Upload authorization token bound to one human input form recipient.

    HITL upload tokens are intentionally separate from app/service bearer tokens.
    The token is stored as an opaque random value so upload endpoints can perform
    a direct lookup without entering the normal Web App authentication chain.
    Upload ownership is resolved from the form's workflow run initiator instead
    of being persisted on the token row itself.
    """

    __tablename__ = "human_input_form_upload_tokens"
    __table_args__ = (
        sa.UniqueConstraint("token", name="human_input_form_upload_tokens_token_key"),
        sa.Index("human_input_form_upload_tokens_form_id_idx", "form_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    form_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    recipient_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    token: Mapped[str] = mapped_column(sa.String(255), nullable=False)

    form: Mapped[HumanInputForm] = relationship(
        HumanInputForm,
        uselist=False,
        foreign_keys=[form_id],
        lazy="raise",
        primaryjoin=lambda: sa.orm.foreign(HumanInputFormUploadToken.form_id) == HumanInputForm.id,
    )


class HumanInputFormUploadFile(DefaultFieldsMixin, Base):
    """Association between a human input form and a file uploaded through its token.

    Ownership remains on ``UploadFile`` itself; this table only records the
    durable form/token/file linkage needed by Human Input flows.
    """

    __tablename__ = "human_input_form_upload_files"
    __table_args__ = (
        sa.UniqueConstraint("upload_file_id", name="human_input_form_upload_files_upload_file_id_key"),
        sa.Index("human_input_form_upload_files_form_id_idx", "form_id"),
        sa.Index("human_input_form_upload_files_upload_token_id_idx", "upload_token_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    form_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    upload_file_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    upload_token_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
