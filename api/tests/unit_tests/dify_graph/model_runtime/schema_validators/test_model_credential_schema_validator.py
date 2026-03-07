import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import (
    CredentialFormSchema,
    FieldModelSchema,
    FormOption,
    FormShowOnObject,
    FormType,
    ModelCredentialSchema,
)
from dify_graph.model_runtime.schema_validators.model_credential_schema_validator import ModelCredentialSchemaValidator


def test_validate_and_filter_with_none_schema():
    validator = ModelCredentialSchemaValidator(ModelType.LLM, None)
    with pytest.raises(ValueError, match="Model credential schema is None"):
        validator.validate_and_filter({})


def test_validate_and_filter_success():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key", zh_Hans="API Key"),
                type=FormType.SECRET_INPUT,
                required=True,
            ),
            CredentialFormSchema(
                variable="optional_field",
                label=I18nObject(en_US="Optional", zh_Hans="可选"),
                type=FormType.TEXT_INPUT,
                required=False,
                default="default_val",
            ),
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    credentials = {"api_key": "sk-123456"}
    result = validator.validate_and_filter(credentials)

    assert result["api_key"] == "sk-123456"
    assert result["optional_field"] == "default_val"
    assert credentials["__model_type"] == ModelType.LLM.value


def test_validate_and_filter_with_show_on():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="mode", label=I18nObject(en_US="Mode", zh_Hans="模式"), type=FormType.TEXT_INPUT, required=True
            ),
            CredentialFormSchema(
                variable="conditional_field",
                label=I18nObject(en_US="Conditional", zh_Hans="条件"),
                type=FormType.TEXT_INPUT,
                required=True,
                show_on=[FormShowOnObject(variable="mode", value="advanced")],
            ),
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    # mode is 'simple', conditional_field should be filtered out
    credentials = {"mode": "simple", "conditional_field": "secret"}
    result = validator.validate_and_filter(credentials)
    assert "conditional_field" not in result
    assert result["mode"] == "simple"

    # mode is 'advanced', conditional_field should be kept
    credentials = {"mode": "advanced", "conditional_field": "secret"}
    result = validator.validate_and_filter(credentials)
    assert result["conditional_field"] == "secret"
    assert result["mode"] == "advanced"

    # show_on variable missing in credentials
    credentials = {"conditional_field": "secret"}  # mode missing
    with pytest.raises(ValueError, match="Variable mode is required"):  # because mode is required in schema
        validator.validate_and_filter(credentials)


def test_validate_and_filter_show_on_missing_trigger_var():
    # specifically test all_show_on_match = False when variable not in credentials
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="optional_trigger",
                label=I18nObject(en_US="Optional Trigger", zh_Hans="可选触发"),
                type=FormType.TEXT_INPUT,
                required=False,
            ),
            CredentialFormSchema(
                variable="conditional_field",
                label=I18nObject(en_US="Conditional", zh_Hans="条件"),
                type=FormType.TEXT_INPUT,
                required=False,
                show_on=[FormShowOnObject(variable="optional_trigger", value="active")],
            ),
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    # optional_trigger missing, conditional_field should be skipped
    result = validator.validate_and_filter({"conditional_field": "val"})
    assert "conditional_field" not in result


def test_common_validator_logic_required():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="api_key",
                label=I18nObject(en_US="API Key", zh_Hans="API Key"),
                type=FormType.SECRET_INPUT,
                required=True,
            )
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    with pytest.raises(ValueError, match="Variable api_key is required"):
        validator.validate_and_filter({})

    with pytest.raises(ValueError, match="Variable api_key is required"):
        validator.validate_and_filter({"api_key": ""})


def test_common_validator_logic_max_length():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="key",
                label=I18nObject(en_US="Key", zh_Hans="Key"),
                type=FormType.TEXT_INPUT,
                required=True,
                max_length=5,
            )
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    with pytest.raises(ValueError, match="Variable key length should not be greater than 5"):
        validator.validate_and_filter({"key": "123456"})


def test_common_validator_logic_invalid_type():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="key", label=I18nObject(en_US="Key", zh_Hans="Key"), type=FormType.TEXT_INPUT, required=True
            )
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    with pytest.raises(ValueError, match="Variable key should be string"):
        validator.validate_and_filter({"key": 123})


def test_common_validator_logic_switch():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="enabled",
                label=I18nObject(en_US="Enabled", zh_Hans="启用"),
                type=FormType.SWITCH,
                required=True,
            )
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    result = validator.validate_and_filter({"enabled": "true"})
    assert result["enabled"] is True

    result = validator.validate_and_filter({"enabled": "false"})
    assert result["enabled"] is False

    with pytest.raises(ValueError, match="Variable enabled should be true or false"):
        validator.validate_and_filter({"enabled": "not_a_bool"})


def test_common_validator_logic_options():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="choice",
                label=I18nObject(en_US="Choice", zh_Hans="选择"),
                type=FormType.SELECT,
                required=True,
                options=[
                    FormOption(label=I18nObject(en_US="A", zh_Hans="A"), value="a"),
                    FormOption(label=I18nObject(en_US="B", zh_Hans="B"), value="b"),
                ],
            )
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    result = validator.validate_and_filter({"choice": "a"})
    assert result["choice"] == "a"

    with pytest.raises(ValueError, match="Variable choice is not in options"):
        validator.validate_and_filter({"choice": "c"})


def test_validate_and_filter_optional_no_default():
    schema = ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model", zh_Hans="模型")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="optional",
                label=I18nObject(en_US="Optional", zh_Hans="可选"),
                type=FormType.TEXT_INPUT,
                required=False,
            )
        ],
    )
    validator = ModelCredentialSchemaValidator(ModelType.LLM, schema)

    result = validator.validate_and_filter({})
    assert "optional" not in result
