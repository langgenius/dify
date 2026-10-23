import pytest
from pydantic import ValidationError

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolParameter


def _make_identity() -> ToolIdentity:
    return ToolIdentity(
        author="author",
        name="tool",
        label=I18nObject(en_US="Label"),
        provider="builtin",
    )


def _make_select_parameter(**updates: object) -> ToolParameter:
    data = ToolParameter.get_simple_instance(
        name="choice",
        llm_description="Choice",
        typ=ToolParameter.ToolParameterType.SELECT,
        required=False,
        options=["a", "b"],
    ).model_dump()
    data.update(updates)
    return ToolParameter.model_validate(data)


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"type": ToolParameter.ToolParameterType.STRING, "multiple": True}, "multiple is only valid"),
        ({"multiple": True, "default": "a"}, "default must be a list"),
        ({"default": ["a"]}, "default must be a list"),
    ],
)
def test_tool_parameter_rejects_invalid_multiple_declarations(updates: dict[str, object], message: str):
    with pytest.raises(ValidationError, match=message):
        _make_select_parameter(**updates)


@pytest.mark.parametrize(
    "parameter_type",
    [ToolParameter.ToolParameterType.SELECT, ToolParameter.ToolParameterType.DYNAMIC_SELECT],
)
def test_tool_parameter_accepts_multiple_select_declarations(parameter_type: ToolParameter.ToolParameterType):
    parameter = _make_select_parameter(type=parameter_type, multiple=True, default=["a"])

    assert parameter.multiple is True


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("a", "must be a list"),
        (["a", 1], "only strings"),
        (["missing"], "not in options"),
        ([], "not found in tool config"),
    ],
)
def test_multiple_select_normalization_rejects_invalid_values(value: object, message: str):
    parameter = _make_select_parameter(multiple=True, required=True)

    with pytest.raises(ValueError, match=message):
        parameter.init_frontend_parameter(value)


def test_multiple_select_normalization_preserves_explicit_empty_list():
    parameter = _make_select_parameter(multiple=True, default=["a"])

    assert parameter.init_frontend_parameter(None) == ["a"]
    assert parameter.init_frontend_parameter([]) == []
    assert parameter.init_frontend_parameter(["a", "b"]) == ["a", "b"]


def test_log_message_metadata_none_defaults_to_empty_dict():
    log_message = ToolInvokeMessage.LogMessage(
        id="log-1",
        label="Log entry",
        status=ToolInvokeMessage.LogMessage.LogStatus.START,
        data={},
        metadata=None,
    )

    assert log_message.metadata == {}


def test_tool_entity_output_schema_none_defaults_to_empty_dict():
    entity = ToolEntity(identity=_make_identity(), output_schema=None)

    assert entity.output_schema == {}


def test_get_parameter_type():
    assert ToolParameter.ToolParameterType.STRING.as_normal_type() == "string"
    assert ToolParameter.ToolParameterType.SELECT.as_normal_type() == "string"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.as_normal_type() == "string"
    assert ToolParameter.ToolParameterType.BOOLEAN.as_normal_type() == "boolean"
    assert ToolParameter.ToolParameterType.NUMBER.as_normal_type() == "number"
    assert ToolParameter.ToolParameterType.FILE.as_normal_type() == "file"
    assert ToolParameter.ToolParameterType.FILES.as_normal_type() == "files"


def test_cast_parameter_by_type():
    # string
    assert ToolParameter.ToolParameterType.STRING.cast_value("test") == "test"
    assert ToolParameter.ToolParameterType.STRING.cast_value(1) == "1"
    assert ToolParameter.ToolParameterType.STRING.cast_value(1.0) == "1.0"
    assert ToolParameter.ToolParameterType.STRING.cast_value(None) == ""

    # secret input
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value("test") == "test"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value(1) == "1"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value(1.0) == "1.0"
    assert ToolParameter.ToolParameterType.SECRET_INPUT.cast_value(None) == ""

    # select
    assert ToolParameter.ToolParameterType.SELECT.cast_value("test") == "test"
    assert ToolParameter.ToolParameterType.SELECT.cast_value(1) == "1"
    assert ToolParameter.ToolParameterType.SELECT.cast_value(1.0) == "1.0"
    assert ToolParameter.ToolParameterType.SELECT.cast_value(None) == ""

    # boolean
    true_values = [True, "True", "true", "1", "YES", "Yes", "yes", "y", "something"]
    for value in true_values:
        assert ToolParameter.ToolParameterType.BOOLEAN.cast_value(value) is True

    false_values = [False, "False", "false", "0", "NO", "No", "no", "n", None, ""]
    for value in false_values:
        assert ToolParameter.ToolParameterType.BOOLEAN.cast_value(value) is False

    # number
    assert ToolParameter.ToolParameterType.NUMBER.cast_value("1") == 1
    assert ToolParameter.ToolParameterType.NUMBER.cast_value("1.0") == 1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value("-1.0") == -1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(1) == 1
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(1.0) == 1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(-1.0) == -1.0
    assert ToolParameter.ToolParameterType.NUMBER.cast_value(None) is None
