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
