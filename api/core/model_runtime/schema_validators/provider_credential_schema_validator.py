from core.model_runtime.entities.provider_entities import ProviderCredentialSchema
from core.model_runtime.schema_validators.common_validator import CommonValidator


class ProviderCredentialSchemaValidator(CommonValidator):
    def __init__(self, provider_credential_schema: ProviderCredentialSchema):
        self.provider_credential_schema = provider_credential_schema

    def validate_and_filter(self, credentials: dict):
        """
        Validate provider credentials

        :param credentials: provider credentials
        :return: validated provider credentials
        """
        # get the credential_form_schemas in provider_credential_schema
        credential_form_schemas = self.provider_credential_schema.credential_form_schemas

        return self._validate_and_filter_credential_form_schemas(credential_form_schemas, credentials)
