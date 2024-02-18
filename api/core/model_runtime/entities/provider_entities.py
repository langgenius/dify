from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType, ProviderModel


class ConfigurateMethod(Enum):
    """
    Enum class for configurate method of provider model.
    """
    PREDEFINED_MODEL = "predefined-model"
    CUSTOMIZABLE_MODEL = "customizable-model"


class FormType(Enum):
    """
    Enum class for form type.
    """
    TEXT_INPUT = "text-input"
    SECRET_INPUT = "secret-input"
    SELECT = "select"
    RADIO = "radio"
    SWITCH = "switch"


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

    def __init__(self, **data):
        super().__init__(**data)
        if not self.label:
            self.label = I18nObject(
                en_US=self.value
            )


class CredentialFormSchema(BaseModel):
    """
    Model class for credential form schema.
    """
    variable: str
    label: I18nObject
    type: FormType
    required: bool = True
    default: Optional[str] = None
    options: Optional[list[FormOption]] = None
    placeholder: Optional[I18nObject] = None
    max_length: int = 0
    show_on: list[FormShowOnObject] = []


class ProviderCredentialSchema(BaseModel):
    """
    Model class for provider credential schema.
    """
    credential_form_schemas: list[CredentialFormSchema]


class FieldModelSchema(BaseModel):
    label: I18nObject
    placeholder: Optional[I18nObject] = None


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
    icon_small: Optional[I18nObject] = None
    icon_large: Optional[I18nObject] = None
    supported_model_types: list[ModelType]
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
    description: Optional[I18nObject] = None
    icon_small: Optional[I18nObject] = None
    icon_large: Optional[I18nObject] = None
    background: Optional[str] = None
    help: Optional[ProviderHelpEntity] = None
    supported_model_types: list[ModelType]
    configurate_methods: list[ConfigurateMethod]
    models: list[ProviderModel] = []
    provider_credential_schema: Optional[ProviderCredentialSchema] = None
    model_credential_schema: Optional[ModelCredentialSchema] = None

    class Config:
        protected_namespaces = ()

    def to_simple_provider(self) -> SimpleProviderEntity:
        """
        Convert to simple provider.

        :return: simple provider
        """
        return SimpleProviderEntity(
            provider=self.provider,
            label=self.label,
            icon_small=self.icon_small,
            icon_large=self.icon_large,
            supported_model_types=self.supported_model_types,
            models=self.models
        )


class ProviderConfig(BaseModel):
    """
    Model class for provider config.
    """
    provider: str
    credentials: dict
