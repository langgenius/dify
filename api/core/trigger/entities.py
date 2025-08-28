from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field

from core.tools.entities.common_entities import I18nObject


class TriggerParameterOption(BaseModel):
    """
    The option of the trigger parameter
    """

    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")


class TriggerParameterType(StrEnum):
    """The type of the parameter"""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    SELECT = "select"
    FILE = "file"
    FILES = "files"
    MODEL_SELECTOR = "model-selector"
    APP_SELECTOR = "app-selector"
    OBJECT = "object"
    ARRAY = "array"
    DYNAMIC_SELECT = "dynamic-select"


class ParameterAutoGenerate(BaseModel):
    """Auto generation configuration for parameters"""

    enabled: bool = Field(default=False, description="Whether auto generation is enabled")
    template: Optional[str] = Field(default=None, description="Template for auto generation")


class ParameterTemplate(BaseModel):
    """Template configuration for parameters"""

    value: str = Field(..., description="Template value")
    type: str = Field(default="jinja2", description="Template type")


class TriggerParameter(BaseModel):
    """
    The parameter of the trigger
    """

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    type: TriggerParameterType = Field(..., description="The type of the parameter")
    auto_generate: Optional[ParameterAutoGenerate] = Field(
        default=None, description="The auto generate of the parameter"
    )
    template: Optional[ParameterTemplate] = Field(default=None, description="The template of the parameter")
    scope: Optional[str] = None
    required: Optional[bool] = False
    default: Union[int, float, str, None] = None
    min: Union[float, int, None] = None
    max: Union[float, int, None] = None
    precision: Optional[int] = None
    options: Optional[list[TriggerParameterOption]] = None
    description: Optional[I18nObject] = None


class TriggerProviderIdentity(BaseModel):
    """
    The identity of the trigger provider
    """

    author: str = Field(..., description="The author of the trigger provider")
    name: str = Field(..., description="The name of the trigger provider")
    label: I18nObject = Field(..., description="The label of the trigger provider")
    description: I18nObject = Field(..., description="The description of the trigger provider")
    icon: Optional[str] = Field(default=None, description="The icon of the trigger provider")
    tags: list[str] = Field(default_factory=list, description="The tags of the trigger provider")


class TriggerIdentity(BaseModel):
    """
    The identity of the trigger
    """

    author: str = Field(..., description="The author of the trigger")
    name: str = Field(..., description="The name of the trigger")
    label: I18nObject = Field(..., description="The label of the trigger")


class TriggerDescription(BaseModel):
    """
    The description of the trigger
    """

    human: I18nObject = Field(..., description="Human readable description")
    llm: I18nObject = Field(..., description="LLM readable description")


class TriggerConfigurationExtraPython(BaseModel):
    """Python configuration for trigger"""

    source: str = Field(..., description="The source file path for the trigger implementation")


class TriggerConfigurationExtra(BaseModel):
    """
    The extra configuration for trigger
    """


class TriggerEntity(BaseModel):
    """
    The configuration of a trigger
    """

    python: TriggerConfigurationExtraPython
    identity: TriggerIdentity = Field(..., description="The identity of the trigger")
    parameters: list[TriggerParameter] = Field(default=[], description="The parameters of the trigger")
    description: TriggerDescription = Field(..., description="The description of the trigger")
    extra: TriggerConfigurationExtra = Field(..., description="The extra configuration of the trigger")
    output_schema: Optional[Mapping[str, Any]] = Field(
        default=None, description="The output schema that this trigger produces"
    )


class TriggerProviderConfigurationExtraPython(BaseModel):
    """Python configuration for trigger provider"""

    source: str = Field(..., description="The source file path for the trigger provider implementation")


class TriggerProviderConfigurationExtra(BaseModel):
    """
    The extra configuration for trigger provider
    """

    python: TriggerProviderConfigurationExtraPython


class OAuthSchema(BaseModel):
    """OAuth configuration schema"""

    authorization_url: str = Field(..., description="OAuth authorization URL")
    token_url: str = Field(..., description="OAuth token URL")
    client_id: str = Field(..., description="OAuth client ID")
    client_secret: str = Field(..., description="OAuth client secret")
    redirect_uri: Optional[str] = Field(default=None, description="OAuth redirect URI")
    scope: Optional[str] = Field(default=None, description="OAuth scope")


class ProviderConfig(BaseModel):
    """Provider configuration item"""

    name: str = Field(..., description="Configuration field name")
    type: str = Field(..., description="Configuration field type")
    required: bool = Field(default=False, description="Whether this field is required")
    default: Any = Field(default=None, description="Default value")
    label: Optional[I18nObject] = Field(default=None, description="Field label")
    description: Optional[I18nObject] = Field(default=None, description="Field description")
    options: Optional[list[dict[str, Any]]] = Field(default=None, description="Options for select type")


class TriggerProviderEntity(BaseModel):
    """
    The configuration of a trigger provider
    """

    identity: TriggerProviderIdentity = Field(..., description="The identity of the trigger provider")
    credentials_schema: list[ProviderConfig] = Field(
        default_factory=list,
        description="The credentials schema of the trigger provider",
    )
    oauth_schema: Optional[OAuthSchema] = Field(
        default=None,
        description="The OAuth schema of the trigger provider if OAuth is supported",
    )
    subscription_schema: list[ProviderConfig] = Field(
        default_factory=list,
        description="The subscription schema for trigger(webhook, polling, etc.) subscription parameters",
    )
    triggers: list[TriggerEntity] = Field(default=[], description="The triggers of the trigger provider")
    extra: TriggerProviderConfigurationExtra = Field(..., description="The extra configuration of the trigger provider")


class Subscription(BaseModel):
    """
    Result of a successful trigger subscription operation.

    Contains all information needed to manage the subscription lifecycle.
    """

    expire_at: int = Field(
        ..., description="The timestamp when the subscription will expire, this for refresh the subscription"
    )

    metadata: dict[str, Any] = Field(
        ..., description="Metadata about the subscription in the external service, defined in subscription_schema"
    )


class Unsubscription(BaseModel):
    """
    Result of a trigger unsubscription operation.

    Provides detailed information about the unsubscription attempt,
    including success status and error details if failed.
    """

    success: bool = Field(..., description="Whether the unsubscription was successful")

    message: Optional[str] = Field(
        None,
        description="Human-readable message about the operation result. "
        "Success message for successful operations, "
        "detailed error information for failures.",
    )


# Export all entities
__all__ = [
    "OAuthSchema",
    "ParameterAutoGenerate",
    "ParameterTemplate",
    "ProviderConfig",
    "Subscription",
    "TriggerConfigurationExtra",
    "TriggerConfigurationExtraPython",
    "TriggerDescription",
    "TriggerEntity",
    "TriggerEntity",
    "TriggerIdentity",
    "TriggerParameter",
    "TriggerParameterOption",
    "TriggerParameterType",
    "TriggerProviderConfigurationExtra",
    "TriggerProviderConfigurationExtraPython",
    "TriggerProviderEntity",
    "TriggerProviderIdentity",
    "Unsubscription",
]
