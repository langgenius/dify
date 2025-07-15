from core.helper import encrypter
from core.variables import SecretVariable, StringVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey


def test_segment_group_to_text():
    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey("user_id"): "fake-user-id",
        },
        user_inputs={},
        environment_variables=[
            SecretVariable(name="secret_key", value="fake-secret-key"),
        ],
        conversation_variables=[],
    )
    variable_pool.add(("node_id", "custom_query"), "fake-user-query")
    template = (
        "Hello, {{#sys.user_id#}}! Your query is {{#node_id.custom_query#}}. And your key is {{#env.secret_key#}}."
    )
    segments_group = variable_pool.convert_template(template)

    assert segments_group.text == "Hello, fake-user-id! Your query is fake-user-query. And your key is fake-secret-key."
    assert segments_group.log == (
        f"Hello, fake-user-id! Your query is fake-user-query."
        f" And your key is {encrypter.obfuscated_token('fake-secret-key')}."
    )


def test_convert_constant_to_segment_group():
    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    template = "Hello, world!"
    segments_group = variable_pool.convert_template(template)
    assert segments_group.text == "Hello, world!"
    assert segments_group.log == "Hello, world!"


def test_convert_variable_to_segment_group():
    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey("user_id"): "fake-user-id",
        },
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    template = "{{#sys.user_id#}}"
    segments_group = variable_pool.convert_template(template)
    assert segments_group.text == "fake-user-id"
    assert segments_group.log == "fake-user-id"
    assert isinstance(segments_group.value[0], StringVariable)
    assert segments_group.value[0].value == "fake-user-id"
