from enum import StrEnum, auto


class CloudPlan(StrEnum):
    """
    Enum representing user plan types in the cloud platform.

    SANDBOX: Free/default plan with limited features
    PROFESSIONAL: Professional paid plan
    TEAM: Team collaboration paid plan
    """

    SANDBOX = auto()
    PROFESSIONAL = auto()
    TEAM = auto()


class DeploymentEdition(StrEnum):
    """Enum representing the deployment edition of the platform."""

    COMMUNITY = "COMMUNITY"
    ENTERPRISE = "ENTERPRISE"
    CLOUD = "CLOUD"


class WebAppAccessMode(StrEnum):
    PUBLIC = "public"
    PRIVATE = "private"
    PRIVATE_ALL = "private_all"
    SSO_VERIFIED = "sso_verified"


class HostedTrialProvider(StrEnum):
    """Enum representing hosted model provider names for trial access."""

    OPENAI = "langgenius/openai/openai"
    ANTHROPIC = "langgenius/anthropic/anthropic"
    GEMINI = "langgenius/gemini/google"
    X = "langgenius/x/x"
    DEEPSEEK = "langgenius/deepseek/deepseek"
    TONGYI = "langgenius/tongyi/tongyi"

    @property
    def config_key(self) -> str:
        """Return the config key used in dify_config (e.g., HOSTED_{config_key}_PAID_ENABLED)."""
        if self == HostedTrialProvider.X:
            return "XAI"
        return self.name


class QuotaType(StrEnum):
    """Supported quota types for tenant feature usage."""

    TRIGGER = auto()
    WORKFLOW = auto()
    UNLIMITED = auto()

    @property
    def billing_key(self) -> str:
        match self:
            case QuotaType.TRIGGER:
                return "trigger_event"
            case QuotaType.WORKFLOW:
                return "api_rate_limit"
            case _:
                raise ValueError(f"Invalid quota type: {self}")
