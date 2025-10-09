import dataclasses

from core.workflow.nodes.base import variable_template_parser
from core.workflow.nodes.base.entities import VariableSelector


def test_extract_selectors_from_template():
    template = (
        "Hello, {{#sys.user_id#}}! Your query is {{#node_id.custom_query#}}. And your key is {{#env.secret_key#}}."
    )
    selectors = variable_template_parser.extract_selectors_from_template(template)
    assert selectors == [
        VariableSelector(variable="#sys.user_id#", value_selector=["sys", "user_id"]),
        VariableSelector(variable="#node_id.custom_query#", value_selector=["node_id", "custom_query"]),
        VariableSelector(variable="#env.secret_key#", value_selector=["env", "secret_key"]),
    ]


def test_invalid_references():
    @dataclasses.dataclass
    class TestCase:
        name: str
        template: str

    cases = [
        TestCase(
            name="lack of closing brace",
            template="Hello, {{#sys.user_id#",
        ),
        TestCase(
            name="lack of opening brace",
            template="Hello, #sys.user_id#}}",
        ),
        TestCase(
            name="lack selector name",
            template="Hello, {{#sys#}}",
        ),
        TestCase(
            name="empty node name part",
            template="Hello, {{#.user_id#}}",
        ),
    ]
    for idx, c in enumerate(cases, 1):
        fail_msg = f"Test case {c.name} failed, index={idx}"
        selectors = variable_template_parser.extract_selectors_from_template(c.template)
        assert selectors == [], fail_msg
        parser = variable_template_parser.VariableTemplateParser(c.template)
        assert parser.extract_variable_selectors() == [], fail_msg
