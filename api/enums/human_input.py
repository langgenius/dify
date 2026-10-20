"""Human Input states and recipients, independent of persistence and services."""

import enum
from enum import StrEnum


class HumanInputFormStatus(enum.StrEnum):
    """Status of a human input form."""

    # Awaiting submission from any recipient. Forms stay in this state until
    # submitted or a timeout rule applies.
    WAITING = enum.auto()
    # Global timeout reached. The workflow run is stopped and will not resume.
    # This is distinct from node-level timeout.
    EXPIRED = enum.auto()
    # Submitted by a recipient; form data is available and execution resumes
    # along the selected action edge.
    SUBMITTED = enum.auto()
    # Node-level timeout reached. The human input node should emit a timeout
    # event and the workflow should resume along the timeout edge.
    TIMEOUT = enum.auto()


class HumanInputFormKind(enum.StrEnum):
    """Kind of a human input form."""

    RUNTIME = enum.auto()  # Form created during workflow execution.
    DELIVERY_TEST = enum.auto()  # Form created for delivery tests.


class ButtonStyle(enum.StrEnum):
    """Button styles for user actions."""

    PRIMARY = enum.auto()
    DEFAULT = enum.auto()
    ACCENT = enum.auto()
    GHOST = enum.auto()


class TimeoutUnit(enum.StrEnum):
    """Timeout unit for form expiration."""

    HOUR = enum.auto()
    DAY = enum.auto()


class FormInputType(enum.StrEnum):
    """Form input types.

    Name for this enumeration are intentionally keep the same as those for
    `VariableEntityType`.
    """

    # Both `TEXT_INPUT` and `PARAGRAPH` represent string input fields.
    # The corresponding generated variable type is `SegmentType.STRING`.
    PARAGRAPH = "paragraph"

    # A single-select input field (e.g., a dropdown or radio buttons).
    # The corresponding generated variable type is `SegmentType.STRING`.
    SELECT = "select"

    # A file input field that accepts a single file.
    #  The corresponding generated variable type is `SegmentType.FILE`.
    FILE = "file"

    # A file input field that accepts zero or more files.
    # The corresponding generated variable type is `SegmentType.ARRAY_FILE`.
    FILE_LIST = "file-list"


class ValueSourceType(enum.StrEnum):
    """ValueSourceType records whether the value comes from a static setting
    in form definition, or a variable while the workflow is running.
    """

    # `VARIABLE` means that the value comes from a variable in workflow execution
    VARIABLE = enum.auto()
    # `CONSTANT` means that the value comes from a static setting in form definition.
    CONSTANT = enum.auto()


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


class DeliveryMethodType(enum.StrEnum):
    WEBAPP = enum.auto()
    EMAIL = enum.auto()


class EmailRecipientType(enum.StrEnum):
    BOUND = "member"
    MEMBER = BOUND
    EXTERNAL = "external"
