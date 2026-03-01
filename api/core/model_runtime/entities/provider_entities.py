from collections.abc import Sequence
from enum import StrEnum, auto

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType


class ConfigurateMethod(StrEnum):
    """
    Enum class for configurate method of provider model.
    """

    PREDEFINED_MODEL = "predefined-model"
    CUSTOMIZABLE_MODEL = "customizable-model"


class FormType(StrEnum):
    """
    Enum class for form type.
    """

    TEXT_INPUT = "text-input"
    SECRET_INPUT = "secret-input"
    SELECT = auto()
    RADIO = auto()
    SWITCH = auto()


class FormShowOnObject(BaseModel):
    """
    Model class for form show on.
    """

    variable: str
    value: str


class FormOption(BaseModel):
    """
    Model class for form option.
    """

    label: I18nObject
    value: str
    show_on: list[FormShowOnObject] = []

    @model_validator(mode="after")
    def _(self):
        if not self.label:
            self.label = I18nObject(en_US=self.value)
        return self


class CredentialFormSchema(BaseModel):
    """
    Model class for credential form schema.
    """

    variable: str
    label: I18nObject
    type: FormType
    required: bool = True
    default: str | None = None
    options: list[FormOption] | None = None
    placeholder: I18nObject | None = None
    max_length: int = 0
    show_on: list[FormShowOnObject] = []


class ProviderCredentialSchema(BaseModel):
    """
    Model class for provider credential schema.
    """

    credential_form_schemas: list[CredentialFormSchema]


class FieldModelSchema(BaseModel):
    label: I18nObject
    placeholder: I18nObject | None = None


class ModelCredentialSchema(BaseModel):
    """
    Model class for model credential schema.
    """

    model: FieldModelSchema
    credential_form_schemas: list[CredentialFormSchema]


class SimpleProviderEntity(BaseModel):
    """
    Simple model class for provider.
    """

    provider: str
    label: I18nObject
    icon_small: I18nObject | None = None
    icon_small_dark: I18nObject | None = None
    supported_model_types: Sequence[ModelType]
    models: list[AIModelEntity] = []


class ProviderHelpEntity(BaseModel):
    """
    Model class for provider help.
    """

    title: I18nObject
    url: I18nObject


class ProviderEntity(BaseModel):
    """
    Model class for provider.
    """

    provider: str
    label: I18nObject
    description: I18nObject | None = None
    icon_small: I18nObject | None = None
    icon_small_dark: I18nObject | None = None
    background: str | None = None
    help: ProviderHelpEntity | None = None
    supported_model_types: Sequence[ModelType]
    configurate_methods: list[ConfigurateMethod]
    models: list[AIModelEntity] = Field(default_factory=list)
    provider_credential_schema: ProviderCredentialSchema | None = None
    model_credential_schema: ModelCredentialSchema | None = None

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    # position from plugin _position.yaml
    position: dict[str, list[str]] | None = {}

    @field_validator("models", mode="before")
    @classmethod
    def validate_models(cls, v):
        # returns EmptyList if v is empty
        if not v:
            return []
        return v

    def to_simple_provider(self) -> SimpleProviderEntity:
        """
        Convert to simple provider.

        :return: simple provider
        """
        return SimpleProviderEntity(
            provider=self.provider,
            label=self.label,
            icon_small=self.icon_small,
            supported_model_types=self.supported_model_types,
            models=self.models,
        )


class ProviderConfig(BaseModel):
    """
    Model class for provider config.
    """

    provider: str
    credentials: dict
