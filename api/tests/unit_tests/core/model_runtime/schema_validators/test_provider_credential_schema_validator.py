import pytest

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.provider_entities import CredentialFormSchema, FormType, ProviderCredentialSchema
from core.model_runtime.schema_validators.provider_credential_schema_validator import ProviderCredentialSchemaValidator


class TestProviderCredentialSchemaValidator:
    def test_validate_and_filter_success(self):
        # Setup schema
        schema = ProviderCredentialSchema(
            credential_form_schemas=[
                CredentialFormSchema(
                    variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT, required=True
                ),
                CredentialFormSchema(
                    variable="endpoint",
                    label=I18nObject(en_US="Endpoint"),
                    type=FormType.TEXT_INPUT,
                    required=False,
                    default="https://api.example.com",
                ),
            ]
        )
        validator = ProviderCredentialSchemaValidator(schema)

        # Test valid credentials
        credentials = {"api_key": "my-secret-key"}
        result = validator.validate_and_filter(credentials)

        assert result == {"api_key": "my-secret-key", "endpoint": "https://api.example.com"}

    def test_validate_and_filter_missing_required(self):
        # Setup schema
        schema = ProviderCredentialSchema(
            credential_form_schemas=[
                CredentialFormSchema(
                    variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT, required=True
                )
            ]
        )
        validator = ProviderCredentialSchemaValidator(schema)

        # Test missing required credentials
        with pytest.raises(ValueError, match="Variable api_key is required"):
            validator.validate_and_filter({})

    def test_validate_and_filter_extra_fields_filtered(self):
        # Setup schema
        schema = ProviderCredentialSchema(
            credential_form_schemas=[
                CredentialFormSchema(
                    variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT, required=True
                )
            ]
        )
        validator = ProviderCredentialSchemaValidator(schema)

        # Test credentials with extra fields
        credentials = {"api_key": "my-secret-key", "extra_field": "should-be-filtered"}
        result = validator.validate_and_filter(credentials)

        assert "api_key" in result
        assert "extra_field" not in result
        assert result == {"api_key": "my-secret-key"}

    def test_init(self):
        schema = ProviderCredentialSchema(credential_form_schemas=[])
        validator = ProviderCredentialSchemaValidator(schema)
        assert validator.provider_credential_schema == schema
