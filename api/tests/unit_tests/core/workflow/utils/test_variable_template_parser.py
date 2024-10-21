from core.variables import SecretVariable
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.utils import variable_template_parser


def test_extract_selectors_from_template():
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
    selectors = variable_template_parser.extract_selectors_from_template(template)
    assert selectors == [
        VariableSelector(variable="#sys.user_id#", value_selector=["sys", "user_id"]),
        VariableSelector(variable="#node_id.custom_query#", value_selector=["node_id", "custom_query"]),
        VariableSelector(variable="#env.secret_key#", value_selector=["env", "secret_key"]),
    ]
