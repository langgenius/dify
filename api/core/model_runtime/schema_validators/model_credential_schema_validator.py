from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ModelCredentialSchema
from core.model_runtime.schema_validators.common_validator import CommonValidator


class ModelCredentialSchemaValidator(CommonValidator):
    def __init__(self, model_type: ModelType, model_credential_schema: ModelCredentialSchema):
        self.model_type = model_type
        self.model_credential_schema = model_credential_schema

    def validate_and_filter(self, credentials: dict) -> dict:
        """
        Validate model credentials

        :param credentials: model credentials
        :return: filtered credentials
        """

        if self.model_credential_schema is None:
            raise ValueError("Model credential schema is None")

        # get the credential_form_schemas in provider_credential_schema
        credential_form_schemas = self.model_credential_schema.credential_form_schemas

        credentials["__model_type"] = self.model_type.value

        return self._validate_and_filter_credential_form_schemas(credential_form_schemas, credentials)
