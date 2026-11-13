from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ModelCredentialSchema
from graphon.model_runtime.schema_validators.common_validator import CommonValidator


class ModelCredentialSchemaValidator(CommonValidator):
    def __init__(
        self,
        model_type: ModelType,
        model_credential_schema: ModelCredentialSchema,
    ) -> None:
        self.model_type = model_type
        self.model_credential_schema = model_credential_schema

    def validate_and_filter(self, credentials: dict) -> dict[str, str | bool]:
        """Validate model credentials and return the filtered credential map."""
        if self.model_credential_schema is None:
            msg = "Model credential schema is None"
            raise ValueError(msg)

        # get the credential_form_schemas in provider_credential_schema
        credential_form_schemas = self.model_credential_schema.credential_form_schemas

        credentials["__model_type"] = self.model_type.value

        return self._validate_and_filter_credential_form_schemas(
            credential_form_schemas,
            credentials,
        )
