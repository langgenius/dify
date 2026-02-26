from core.workflow.nodes.base.variable_template_parser import (
    VariableTemplateParser,
    extract_selectors_from_template,
)


def test_extract_selectors_from_template_only_returns_valid_selectors():
    template = "Hello {{#node_1.user.name#}} and {{#node_2.user.age#}} and raw text"

    selectors = extract_selectors_from_template(template)

    assert [selector.variable for selector in selectors] == ["#node_1.user.name#", "#node_2.user.age#"]
    assert selectors[0].value_selector == ["node_1", "user", "name"]
    assert selectors[1].value_selector == ["node_2", "user", "age"]


def test_extract_variable_selectors_skips_invalid_keys():
    parser = VariableTemplateParser("{{#node_1.user.name#}}")
    parser.variable_keys = ["#node_1.user.name#", "#invalid#"]

    selectors = parser.extract_variable_selectors()

    assert len(selectors) == 1
    assert selectors[0].variable == "#node_1.user.name#"


def test_format_converts_types_and_strips_special_tokens():
    parser = VariableTemplateParser(
        "n={{#node.value.none#}}, l={{#node.value.list#}}, "
        "d={{#node.value.dict#}}, m={{#node.value.missing#}} <|assistant|>"
    )

    result = parser.format(
        {
            "#node.value.none#": None,
            "#node.value.list#": ["a", "b"],
            "#node.value.dict#": {"k": 1},
        }
    )

    assert result == "n=, l=['a', 'b'], d={'k': 1}, m={#node.value.missing#} "


def test_remove_template_variables_rewrites_nested_template_tokens():
    text = "prefix {{#node.output.value#}} suffix"

    result = VariableTemplateParser.remove_template_variables(text)

    assert result == "prefix {#node.output.value#} suffix"
