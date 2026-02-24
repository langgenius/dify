import pytest

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.provider_entities import CredentialFormSchema, FormOption, FormShowOnObject, FormType
from core.model_runtime.schema_validators.common_validator import CommonValidator


class TestCommonValidator:
    def test_validate_credential_form_schema_required_missing(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(
            variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT, required=True
        )
        with pytest.raises(ValueError, match="Variable api_key is required"):
            validator._validate_credential_form_schema(schema, {})

    def test_validate_credential_form_schema_not_required_missing_with_default(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(
            variable="api_key",
            label=I18nObject(en_US="API Key"),
            type=FormType.TEXT_INPUT,
            required=False,
            default="default_value",
        )
        assert validator._validate_credential_form_schema(schema, {}) == "default_value"

    def test_validate_credential_form_schema_not_required_missing_no_default(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(
            variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT, required=False
        )
        assert validator._validate_credential_form_schema(schema, {}) is None

    def test_validate_credential_form_schema_max_length_exceeded(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(
            variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT, max_length=5
        )
        with pytest.raises(ValueError, match="Variable api_key length should not be greater than 5"):
            validator._validate_credential_form_schema(schema, {"api_key": "123456"})

    def test_validate_credential_form_schema_not_string(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.TEXT_INPUT)
        with pytest.raises(ValueError, match="Variable api_key should be string"):
            validator._validate_credential_form_schema(schema, {"api_key": 123})

    def test_validate_credential_form_schema_select_invalid_option(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(
            variable="mode",
            label=I18nObject(en_US="Mode"),
            type=FormType.SELECT,
            options=[
                FormOption(label=I18nObject(en_US="Fast"), value="fast"),
                FormOption(label=I18nObject(en_US="Slow"), value="slow"),
            ],
        )
        with pytest.raises(ValueError, match="Variable mode is not in options"):
            validator._validate_credential_form_schema(schema, {"mode": "medium"})

    def test_validate_credential_form_schema_select_valid_option(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(
            variable="mode",
            label=I18nObject(en_US="Mode"),
            type=FormType.SELECT,
            options=[
                FormOption(label=I18nObject(en_US="Fast"), value="fast"),
                FormOption(label=I18nObject(en_US="Slow"), value="slow"),
            ],
        )
        assert validator._validate_credential_form_schema(schema, {"mode": "fast"}) == "fast"

    def test_validate_credential_form_schema_switch_invalid(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(variable="enabled", label=I18nObject(en_US="Enabled"), type=FormType.SWITCH)
        with pytest.raises(ValueError, match="Variable enabled should be true or false"):
            validator._validate_credential_form_schema(schema, {"enabled": "maybe"})

    def test_validate_credential_form_schema_switch_valid(self):
        validator = CommonValidator()
        schema = CredentialFormSchema(variable="enabled", label=I18nObject(en_US="Enabled"), type=FormType.SWITCH)
        assert validator._validate_credential_form_schema(schema, {"enabled": "true"}) is True
        assert validator._validate_credential_form_schema(schema, {"enabled": "FALSE"}) is False

    def test_validate_and_filter_credential_form_schemas_with_show_on(self):
        validator = CommonValidator()
        schemas = [
            CredentialFormSchema(
                variable="auth_type",
                label=I18nObject(en_US="Auth Type"),
                type=FormType.SELECT,
                options=[
                    FormOption(label=I18nObject(en_US="API Key"), value="api_key"),
                    FormOption(label=I18nObject(en_US="OAuth"), value="oauth"),
                ],
            ),
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.TEXT_INPUT,
                show_on=[FormShowOnObject(variable="auth_type", value="api_key")],
            ),
            CredentialFormSchema(
                variable="client_id",
                label=I18nObject(en_US="Client ID"),
                type=FormType.TEXT_INPUT,
                show_on=[FormShowOnObject(variable="auth_type", value="oauth")],
            ),
        ]

        # Case 1: auth_type = api_key
        credentials = {"auth_type": "api_key", "api_key": "my_secret"}
        result = validator._validate_and_filter_credential_form_schemas(schemas, credentials)
        assert "auth_type" in result
        assert "api_key" in result
        assert "client_id" not in result
        assert result["api_key"] == "my_secret"

        # Case 2: auth_type = oauth
        credentials = {"auth_type": "oauth", "client_id": "my_client"}
        result = validator._validate_and_filter_credential_form_schemas(schemas, credentials)
        # Note: 'auth_type' contains 'oauth'. 'result' contains keys that pass validation.
        # Since 'oauth' is not an empty string, it is in result.
        assert "auth_type" in result
        assert "api_key" not in result
        assert "client_id" in result
        assert result["client_id"] == "my_client"

    def test_validate_and_filter_show_on_missing_variable(self):
        validator = CommonValidator()
        schemas = [
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.TEXT_INPUT,
                show_on=[FormShowOnObject(variable="auth_type", value="api_key")],
            )
        ]
        # auth_type is missing in credentials, so api_key should be filtered out
        result = validator._validate_and_filter_credential_form_schemas(schemas, {})
        assert result == {}

    def test_validate_and_filter_show_on_mismatch_value(self):
        validator = CommonValidator()
        schemas = [
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.TEXT_INPUT,
                show_on=[FormShowOnObject(variable="auth_type", value="api_key")],
            )
        ]
        # auth_type is oauth, which doesn't match show_on
        result = validator._validate_and_filter_credential_form_schemas(schemas, {"auth_type": "oauth"})
        assert result == {}

    def test_validate_and_filter_multiple_show_on(self):
        validator = CommonValidator()
        schemas = [
            CredentialFormSchema(
                variable="target",
                label=I18nObject(en_US="Target"),
                type=FormType.TEXT_INPUT,
                show_on=[FormShowOnObject(variable="v1", value="a"), FormShowOnObject(variable="v2", value="b")],
            )
        ]
        # Both match
        assert "target" in validator._validate_and_filter_credential_form_schemas(
            schemas, {"v1": "a", "v2": "b", "target": "val"}
        )
        # One mismatch
        assert "target" not in validator._validate_and_filter_credential_form_schemas(
            schemas, {"v1": "a", "v2": "c", "target": "val"}
        )
        # One missing
        assert "target" not in validator._validate_and_filter_credential_form_schemas(
            schemas, {"v1": "a", "target": "val"}
        )

    def test_validate_and_filter_skips_falsy_results(self):
        validator = CommonValidator()
        schemas = [
            CredentialFormSchema(variable="enabled", label=I18nObject(en_US="Enabled"), type=FormType.SWITCH),
            CredentialFormSchema(
                variable="empty_str", label=I18nObject(en_US="Empty"), type=FormType.TEXT_INPUT, required=False
            ),
        ]
        # Result of false switch is False. if result: is false. Not added.
        # Result of empty string is "", if result: is false. Not added.
        credentials = {"enabled": "false", "empty_str": ""}
        result = validator._validate_and_filter_credential_form_schemas(schemas, credentials)
        assert "enabled" not in result
        assert "empty_str" not in result
