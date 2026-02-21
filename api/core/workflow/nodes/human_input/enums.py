import enum


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


class DeliveryMethodType(enum.StrEnum):
    """Delivery method types for human input forms."""

    # WEBAPP controls whether the form is delivered to the web app. It not only controls
    # the standalone web app, but also controls the installed apps in the console.
    WEBAPP = enum.auto()

    EMAIL = enum.auto()


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
    """Form input types."""

    TEXT_INPUT = enum.auto()
    PARAGRAPH = enum.auto()


class PlaceholderType(enum.StrEnum):
    """Default value types for form inputs."""

    VARIABLE = enum.auto()
    CONSTANT = enum.auto()


class EmailRecipientType(enum.StrEnum):
    """Email recipient types."""

    MEMBER = enum.auto()
    EXTERNAL = enum.auto()
