from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.helper import generate_string

from .base import Base, ModelMixin
from .types import EnumText, StringUUID


class HumanInputFormStatus(StrEnum):
    WAITING = "waiting"
    EXPIRED = "expired"
    SUBMITTED = "submitted"
    TIMEOUT = "timeout"


class HumanInputSubmissionType(StrEnum):
    web_form = "web_form"
    web_app = "web_app"
    email = "email"


_token_length = 22
# A 32-character string can store a base64-encoded value with 192 bits of entropy
# or a base62-encoded value with over 180 bits of entropy, providing sufficient
# uniqueness for most use cases.
_token_field_length = 32
_email_field_length = 330


def _generate_token():
    return generate_string(_token_length)


class HumanInputForm(ModelMixin, Base):
    __tablename__ = "human_input_forms"

    # `tenant_id` identifies the tenant associated with this suspension,
    # corresponding to the `id` field in the `Tenant` model.
    tenant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )

    # `app_id` represents the application identifier associated with this state.
    # It corresponds to the `id` field in the `App` model.
    #
    # While this field is technically redundant (as the corresponding app can be
    # determined by querying the `Workflow`), it is retained to simplify data
    # cleanup and management processes.
    app_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )

    workflow_run_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
    )

    form_definition: Mapped[str] = mapped_column(sa.Text, nullable=False)
    rendered_content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    status: Mapped[HumanInputFormStatus] = mapped_column(
        EnumText(HumanInputFormStatus),
        nullable=False,
        default=HumanInputFormStatus.WAITING,
    )

    web_app_token: Mapped[str] = mapped_column(
        sa.VARCHAR(_token_field_length),
        nullable=True,
    )

    # The following fields are not null if the form is submitted.

    # The inputs provided by the user when resuming the suspended workflow.
    # These inputs are serialized as a JSON-formatted string (e.g., `{}`).
    #
    # This field is `NULL` if no inputs were submitted by the user.
    submitted_data: Mapped[str] = mapped_column(sa.Text, nullable=True)

    submitted_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=True)

    submission_type: Mapped[HumanInputSubmissionType] = mapped_column(
        EnumText(HumanInputSubmissionType),
        nullable=True,
    )

    # If the submission happens in dashboard (Studio for orchestrate the workflow, or
    # Explore for using published apps), which requires user to login before submission.
    # Then the `submission_user_id` records the user id
    # of submitter, else `None`.
    submission_user_id: Mapped[str] = mapped_column(StringUUID, nullable=True)

    # If the submission happens in WebApp (which does not requires user to login before submission)
    # Then the `submission_user_id` records the end_user_id of submitter, else `None`.
    submission_end_user_id: Mapped[str] = mapped_column(StringUUID, nullable=True)

    # IF the submitter receives a email and
    submitter_email: Mapped[str] = mapped_column(sa.VARCHAR(_email_field_length), nullable=True)


# class HumanInputEmailDelivery(ModelMixin, Base):
#     # form_id refers to `HumanInputForm.id`
#     form_id: Mapped[str] = mapped_column(
#         StringUUID,
#         nullable=False,
#     )

#     # IF the submitter receives a email and
#     email: Mapped[str] = mapped_column(__name_pos=sa.VARCHAR(_email_field_length), nullable=False)
#     user_id: Mapped[str] = mapped_column(
#         StringUUID,
#         nullable=True,
#     )

#     email_link_token: Mapped[str] = mapped_column(
#         sa.VARCHAR(_token_field_length),
#         nullable=False,
#         default=_generate_token,
#     )
