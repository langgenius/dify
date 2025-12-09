import pytest

from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.app.apps.base_app_generator import BaseAppGenerator


def test_validate_inputs_with_zero():
    base_app_generator = BaseAppGenerator()

    var = VariableEntity(
        variable="test_var",
        label="test_var",
        type=VariableEntityType.NUMBER,
        required=True,
    )

    # Test with input 0
    result = base_app_generator._validate_inputs(
        variable_entity=var,
        value=0,
    )

    assert result == 0

    # Test with input "0" (string)
    result = base_app_generator._validate_inputs(
        variable_entity=var,
        value="0",
    )

    assert result == 0


def test_validate_input_with_none_for_required_variable():
    base_app_generator = BaseAppGenerator()

    for var_type in VariableEntityType:
        var = VariableEntity(
            variable="test_var",
            label="test_var",
            type=var_type,
            required=True,
        )

        # Test with input None
        with pytest.raises(ValueError) as exc_info:
            base_app_generator._validate_inputs(
                variable_entity=var,
                value=None,
            )

        assert str(exc_info.value) == "test_var is required in input form"


def test_validate_inputs_with_default_value():
    """Test that default values are used when input is None for optional variables"""
    base_app_generator = BaseAppGenerator()

    # Test with string default value for TEXT_INPUT
    var_string = VariableEntity(
        variable="test_var",
        label="test_var",
        type=VariableEntityType.TEXT_INPUT,
        required=False,
        default="default_string",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_string,
        value=None,
    )

    assert result == "default_string"

    # Test with string default value for PARAGRAPH
    var_paragraph = VariableEntity(
        variable="test_paragraph",
        label="test_paragraph",
        type=VariableEntityType.PARAGRAPH,
        required=False,
        default="default paragraph text",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_paragraph,
        value=None,
    )

    assert result == "default paragraph text"

    # Test with SELECT default value
    var_select = VariableEntity(
        variable="test_select",
        label="test_select",
        type=VariableEntityType.SELECT,
        required=False,
        default="option1",
        options=["option1", "option2", "option3"],
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_select,
        value=None,
    )

    assert result == "option1"

    # Test with number default value (int)
    var_number_int = VariableEntity(
        variable="test_number_int",
        label="test_number_int",
        type=VariableEntityType.NUMBER,
        required=False,
        default=42,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_int,
        value=None,
    )

    assert result == 42

    # Test with number default value (float)
    var_number_float = VariableEntity(
        variable="test_number_float",
        label="test_number_float",
        type=VariableEntityType.NUMBER,
        required=False,
        default=3.14,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_float,
        value=None,
    )

    assert result == 3.14

    # Test with number default value as string (frontend sends as string)
    var_number_string = VariableEntity(
        variable="test_number_string",
        label="test_number_string",
        type=VariableEntityType.NUMBER,
        required=False,
        default="123",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_string,
        value=None,
    )

    assert result == 123
    assert isinstance(result, int)

    # Test with float number default value as string
    var_number_float_string = VariableEntity(
        variable="test_number_float_string",
        label="test_number_float_string",
        type=VariableEntityType.NUMBER,
        required=False,
        default="45.67",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_float_string,
        value=None,
    )

    assert result == 45.67
    assert isinstance(result, float)

    # Test with CHECKBOX default value (bool)
    var_checkbox_true = VariableEntity(
        variable="test_checkbox_true",
        label="test_checkbox_true",
        type=VariableEntityType.CHECKBOX,
        required=False,
        default=True,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_checkbox_true,
        value=None,
    )

    assert result is True

    var_checkbox_false = VariableEntity(
        variable="test_checkbox_false",
        label="test_checkbox_false",
        type=VariableEntityType.CHECKBOX,
        required=False,
        default=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_checkbox_false,
        value=None,
    )

    assert result is False

    # Test with None as explicit default value
    var_none_default = VariableEntity(
        variable="test_none",
        label="test_none",
        type=VariableEntityType.TEXT_INPUT,
        required=False,
        default=None,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_none_default,
        value=None,
    )

    assert result is None

    # Test that actual input value takes precedence over default
    result = base_app_generator._validate_inputs(
        variable_entity=var_string,
        value="actual_value",
    )

    assert result == "actual_value"

    # Test that actual number input takes precedence over default
    result = base_app_generator._validate_inputs(
        variable_entity=var_number_int,
        value=999,
    )

    assert result == 999

    # Test with FILE default value (dict format from frontend)
    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=False,
        default={"id": "file123", "name": "default.pdf"},
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file,
        value=None,
    )

    assert result == {"id": "file123", "name": "default.pdf"}

    # Test with FILE_LIST default value (list of dicts)
    var_file_list = VariableEntity(
        variable="test_file_list",
        label="test_file_list",
        type=VariableEntityType.FILE_LIST,
        required=False,
        default=[{"id": "file1", "name": "doc1.pdf"}, {"id": "file2", "name": "doc2.pdf"}],
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file_list,
        value=None,
    )

    assert result == [{"id": "file1", "name": "doc1.pdf"}, {"id": "file2", "name": "doc2.pdf"}]


def test_validate_inputs_optional_file_with_empty_string():
    """Test that optional FILE variable with empty string returns None"""
    base_app_generator = BaseAppGenerator()

    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file,
        value="",
    )

    assert result is None


def test_validate_inputs_optional_file_list_with_empty_list():
    """Test that optional FILE_LIST variable with empty list returns None"""
    base_app_generator = BaseAppGenerator()

    var_file_list = VariableEntity(
        variable="test_file_list",
        label="test_file_list",
        type=VariableEntityType.FILE_LIST,
        required=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file_list,
        value=[],
    )

    assert result is None


def test_validate_inputs_required_file_with_empty_string_fails():
    """Test that required FILE variable with empty string still fails validation"""
    base_app_generator = BaseAppGenerator()

    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=True,
    )

    with pytest.raises(ValueError) as exc_info:
        base_app_generator._validate_inputs(
            variable_entity=var_file,
            value="",
        )

    assert "must be a file" in str(exc_info.value)


def test_validate_inputs_optional_file_with_empty_string_ignores_default():
    """Test that optional FILE variable with empty string returns None, not the default"""
    base_app_generator = BaseAppGenerator()

    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=False,
        default={"id": "file123", "name": "default.pdf"},
    )

    # When value is empty string (from frontend), should return None, not default
    result = base_app_generator._validate_inputs(
        variable_entity=var_file,
        value="",
    )

    assert result is None
