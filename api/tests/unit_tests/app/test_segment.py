from core.app.segments import SecretVariable, parser
from core.helper import encrypter
from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool


def test_segment_group_to_text():
    variable_pool = VariablePool(
        system_variables={
            SystemVariable('user_id'): 'fake-user-id',
        },
        user_inputs={},
        environment_variables=[
            SecretVariable(name='secret_key', value='fake-secret-key'),
        ],
    )
    variable_pool.add(('node_id', 'custom_query'), 'fake-user-query')
    template = "Hello, {{#sys.user_id#}}! Your query is {{#node_id.custom_query#}}. And your key is {{#env.secret_key#}}."
    segments_group = parser.convert_mixed_template(template=template, variable_pool=variable_pool)

    assert segments_group.text == "Hello, fake-user-id! Your query is fake-user-query. And your key is fake-secret-key."
    assert segments_group.log == f"Hello, fake-user-id! Your query is fake-user-query. And your key is {encrypter.obfuscated_token('fake-secret-key')}."
