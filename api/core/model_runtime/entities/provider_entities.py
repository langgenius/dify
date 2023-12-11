from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import ModelType, ProviderModel, AIModelEntity


class ConfigurateMethod(Enum):
    """
    Enum class for configurate method of provider model.
    """
    PREDEFINED_MODEL = "predefined-model"
    CUSTOMIZABLE_MODEL = "customizable-model"
    FETCH_FROM_REMOTE = "fetch-from-remote"


class FormType(Enum):
    """
    Enum class for form type.
    """
    TEXT_INPUT = "text-input"
    SECRET_INPUT = "secret-input"
    SELECT = "select"
    RADIO = "radio"


class FormOption(BaseModel):
    """
    Model class for form option.
    """
    label: I18nObject
    value: str


class FormShowOnObject(BaseModel):
    """
    Model class for form show on.
    """
    variable: str
    value: str


class CredentialFormSchema(BaseModel):
    """
    Model class for credential form schema.
    """
    variable: str
    label: I18nObject
    type: FormType
    required: bool
    default: Optional[str] = None
    options: Optional[list[FormOption]] = None
    placeholder: I18nObject
    max_length: int = 0
    show_on: list[FormShowOnObject] = []


class ProviderCredentialSchema(BaseModel):
    """
    Model class for provider credential schema.
    """
    credential_form_schemas: list[CredentialFormSchema]


class FieldModelSchema(BaseModel):
    label: I18nObject
    placeholder: I18nObject


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
    icon_small: I18nObject
    icon_large: I18nObject
    supported_model_types: list[ModelType]
    models: list[AIModelEntity] = []


class ProviderEntity(BaseModel):
    """
    Model class for provider.
    """
    provider: str
    label: I18nObject
    icon_small: I18nObject
    icon_large: I18nObject
    background: Optional[I18nObject] = None
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
            supported_model_types=self.supported_model_types
        )


class ProviderConfig(BaseModel):
    """
    Model class for provider config.
    """
    provider: str
    credentials: dict
