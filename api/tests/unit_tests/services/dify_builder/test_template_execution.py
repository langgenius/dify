"""Bounded Template behavior through existing admission, factory and native runner.

The missing-feature RED is valid Template refusal, never a future-module import.
Literal outputs catch incorrect whitespace, operand semantics and byte accounting.
Effectful owners, Jinja compilation/rendering and deliberate parser faults are replaced.
"""

from copy import deepcopy
from unittest.mock import Mock

import pytest
import yaml

from core.dify_builder.execution_policy import BuilderExecutionPolicyError, admitted_node_bindings, canonical_digest
from core.workflow.restricted_execution import validate_restricted_node, validate_restricted_raw_node
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError
from tests.unit_tests.core.dify_builder.test_execution_policy import snapshot
from tests.unit_tests.core.workflow.graph_engine.test_builder_restricted_native import (
    FIXTURES,
    execute_native,
    init_runner_graph,
    prepare_native,
    receipts,
)
from tests.unit_tests.core.workflow.graph_engine.test_builder_restricted_native import (
    forbid_live as forbid_live,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


@pytest.fixture(autouse=True)
def no_jinja_compilation(monkeypatch):
    """Restricted rendering interprets finite AST only; lex/parse stay real."""
    from jinja2 import Environment, Template, debug

    spies = []
    for owner, names in (
        (Environment, ("from_string", "compile", "compile_expression", "compile_templates", "_generate", "_compile")),
        (Template, ("render", "generate", "render_async", "generate_async")),
        (debug, ("rewrite_traceback_stack", "fake_traceback")),
    ):
        for name in names:
            spy = Mock(side_effect=AssertionError(f"Jinja compilation/rendering reached: {name}"))
            monkeypatch.setattr(owner, name, spy)
            spies.append(spy)
    yield
    # Assert even if a renderer catches the forbidden call and reports failure.
    for spy in spies:
        spy.assert_not_called()


def template_graph(template=None, names=("subject", "body")):
    graph = yaml.safe_load((FIXTURES / "template_notification.yml").read_text())
    if template is not None:
        graph["nodes"][1]["data"]["template"] = template
    graph["nodes"][0]["data"]["variables"] = [{"variable": name, "label": name, "type": "text-input"} for name in names]
    graph["nodes"][1]["data"]["variables"] = [{"variable": name, "value_selector": ["start", name]} for name in names]
    return graph


def renderer_from_factory(owned, template="{{ subject }}", names=("subject", "body")):
    factory, _, _ = prepare_native(
        owned,
        "template_notification.yml",
        graph_config=template_graph(template, names),
        inputs=dict.fromkeys(names, "safe"),
    )
    node = factory.create_node(factory.init_params.graph_config["nodes"][1])
    assert type(node) is TemplateTransformNode
    renderer = node._jinja2_template_renderer
    assert isinstance(renderer, Jinja2TemplateRenderer)
    return renderer


@pytest.mark.parametrize(
    ("inputs", "want"),
    [
        pytest.param(
            {"subject": "  Notice  ", "body": "First paragraph.\nSecond paragraph."},
            "## Notice\n\nFirst paragraph.\nSecond paragraph.",
            id="paragraphs",
        ),
        pytest.param({"subject": "", "body": ""}, "", id="empty-both"),
        pytest.param({"subject": " \t", "body": "\n "}, "", id="whitespace-both"),
        pytest.param({"subject": " Notice ", "body": " \n"}, "## Notice", id="subject-only"),
        pytest.param({"subject": " \t", "body": "  First\nSecond  "}, "  First\nSecond  ", id="body-verbatim"),
        pytest.param(
            {"subject": "Data", "body": "{{ cycler.__init__.__globals__ }}"},
            "## Data\n\n{{ cycler.__init__.__globals__ }}",
            id="input-stays-data",
        ),
    ],
)
def test_template_ticket_outputs_use_real_runner_and_native_nodes(owned, forbid_live, inputs, want):
    factory, context, recorder = prepare_native(owned, "template_notification.yml", inputs=inputs)
    runner_graph = init_runner_graph(owned, factory, context, recorder)
    graph, events, error = execute_native(factory, graph=runner_graph)
    assert error is None
    assert type(graph.nodes["template"]) is TemplateTransformNode
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"notification_markdown": want}]
    assert [e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)] == ["start", "template", "end"]
    assert recorder.healthy
    assert receipts(owned) == []
    assert forbid_live == []


@pytest.mark.parametrize(
    ("inputs", "want"),
    [
        pytest.param({"heading": "  Update ", "detail": ""}, "[Update]", id="renamed-if"),
        pytest.param({"heading": "", "detail": "Details"}, "fallback:Details", id="renamed-elif"),
        pytest.param({"heading": "", "detail": ""}, "none", id="renamed-else"),
    ],
)
def test_generic_template_if_elif_else_and_scalar_short_circuit(owned, inputs, want):
    text = (
        "{% if not heading|trim and not detail|trim %}none"
        "{% elif heading|trim or detail|trim %}"
        "{% if heading|trim %}[{{ heading|trim }}]{% else %}fallback:{{ detail }}{% endif %}{% endif %}"
    )
    factory, _, _ = prepare_native(
        owned,
        "template_notification.yml",
        graph_config=template_graph(text, ("heading", "detail")),
        inputs=inputs,
    )
    _, events, error = execute_native(factory)
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"notification_markdown": want}]
    assert receipts(owned) == []


def test_multiple_native_templates_accept_only_earlier_output_capability(owned):
    graph = template_graph("[{{ subject|trim }}]")
    second = {
        "id": "format",
        "data": {
            "type": "template-transform",
            "template": "Message: {{ prior }} / {{ body }}",
            "variables": [
                {"variable": "prior", "value_selector": ["template", "output"]},
                {"variable": "body", "value_selector": ["start", "body"]},
            ],
        },
    }
    graph["nodes"].insert(2, second)
    graph["nodes"][-1]["data"]["outputs"][0]["value_selector"] = ["format", "output"]
    graph["edges"] = [
        {"source": "start", "target": "template"},
        {"source": "template", "target": "format"},
        {"source": "format", "target": "end"},
    ]
    factory, _, _ = prepare_native(
        owned,
        "template_notification.yml",
        graph_config=graph,
        inputs={"subject": " News ", "body": "Line"},
    )
    _, events, error = execute_native(factory)
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [
        {"notification_markdown": "Message: [News] / Line"}
    ]
    assert receipts(owned) == []


@pytest.mark.parametrize(
    ("template", "values", "want"),
    [
        pytest.param("{{ subject }}|{{ body }}", {"subject": None, "body": True}, "None|True", id="none-bool"),
        pytest.param("{{ subject }}|{{ body|trim }}", {"subject": 42, "body": 1.25}, "42|1.25", id="number-trim"),
        pytest.param("{{ subject or body }}|{{ subject and body }}", {"subject": "", "body": "B"}, "B|", id="operands"),
        pytest.param("\n{{- subject -}}\n", {"subject": " X ", "body": ""}, " X ", id="whitespace-controls"),
        pytest.param("literal\n", {"subject": "", "body": ""}, "literal", id="final-newline"),
        pytest.param("{# comment #}{{ '\\u2713' }}", {"subject": "", "body": ""}, "✓", id="primitive-constant"),
    ],
)
def test_injected_native_renderer_preserves_scalar_and_whitespace_semantics(owned, template, values, want):
    renderer = renderer_from_factory(owned, template)
    assert renderer.render_template(template, values) == want
    assert receipts(owned) == []


@pytest.mark.parametrize(
    "template",
    [
        pytest.param("{{ subject.__class__ }}", id="attribute"),
        pytest.param("{{ subject[0] }}", id="index"),
        pytest.param("{{ cycler('x') }}", id="call-global"),
        pytest.param("{% for x in subject %}{{ x }}{% endfor %}", id="loop"),
        pytest.param("{{ subject * 1000000 }}", id="repetition"),
        pytest.param("{{ 1 + 2 }}", id="arithmetic"),
        pytest.param("{{ subject|upper }}", id="arbitrary-filter"),
        pytest.param("{{ subject|trim('x') }}", id="trim-argument"),
        pytest.param("{{ subject is defined }}", id="test"),
        pytest.param("{% set x = subject %}{{ x }}", id="assignment"),
        pytest.param("{% include 'secret' %}", id="include"),
        pytest.param("{% import 'secret' as x %}", id="import"),
        pytest.param("{% extends 'secret' %}", id="extends"),
        pytest.param("{% macro x() %}private{% endmacro %}", id="macro"),
        pytest.param("{{ undeclared }}", id="undeclared"),
        pytest.param("{% if false %}{{ subject.__class__ }}{% endif %}safe", id="dead-branch"),
        pytest.param("{% if subject %}missing endif SECRET-TEMPLATE", id="syntax-error"),
    ],
)
def test_unreviewed_template_ast_refuses_even_when_unreachable(template):
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(template_graph(template)))
    assert error.value.reason_code == "unsupported_template_syntax"
    assert "SECRET-TEMPLATE" not in str(error.value)


@pytest.mark.parametrize(
    "mutation",
    [
        "missing-template",
        "non-string-template",
        "duplicate-name",
        "illegal-name",
        "unicode-name",
        "long-name",
        "too-many-variables",
        "missing-selector",
        "nested-selector",
        "downstream",
        "env",
        "system",
        "file",
    ],
)
def test_template_raw_configuration_and_selector_capabilities_refuse(mutation):
    graph = template_graph()
    data = graph["nodes"][1]["data"]
    variables = data["variables"]
    if mutation == "missing-template":
        del data["template"]
    elif mutation == "non-string-template":
        data["template"] = {"secret": "SECRET-CONFIG"}
    elif mutation == "duplicate-name":
        variables.append(deepcopy(variables[0]))
    elif mutation in {"illegal-name", "unicode-name", "long-name"}:
        variables[0]["variable"] = {"illegal-name": "bad-name", "unicode-name": "变量", "long-name": "a" * 65}[mutation]
    elif mutation == "too-many-variables":
        graph = template_graph("literal", tuple(f"v{i}" for i in range(33)))
    elif mutation == "missing-selector":
        del variables[0]["value_selector"]
    elif mutation == "file":
        graph["nodes"][0]["data"]["variables"][0]["type"] = "file"
    else:
        variables[0]["value_selector"] = {
            "nested-selector": ["start", "subject", "secret"],
            "downstream": ["end", "notification_markdown"],
            "env": ["env", "secret"],
            "system": ["sys", "user_id"],
        }[mutation]
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(graph))
    assert "SECRET-CONFIG" not in str(error.value)


@pytest.mark.parametrize("output", ["headers", "status_code", "file"])
def test_template_cannot_select_non_body_http_capabilities(output):
    graph = template_graph("{{ subject }}")
    http = yaml.safe_load((FIXTURES / "http_text.yml").read_text())["nodes"][1]
    http["data"]["url"] = "https://sample.invalid/fixed"
    graph["nodes"].insert(1, http)
    graph["nodes"][2]["data"]["variables"][0]["value_selector"] = ["http", output]
    graph["edges"] = [
        {"source": "start", "target": "http"},
        {"source": "http", "target": "template"},
        {"source": "template", "target": "end"},
    ]
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(graph))
    assert error.value.reason_code == "unsupported_template_selector"


@pytest.mark.parametrize("text", ["x" * 16385, "é" * 8193], ids=["ascii-over", "utf8-over"])
def test_source_byte_limit_precedes_parser_allocation(monkeypatch, text):
    from jinja2 import Environment

    def forbidden(*_args, **_kwargs):
        pytest.fail("over-limit source reached Jinja parser")

    monkeypatch.setattr(Environment, "parse", forbidden)
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(template_graph(text)))
    assert error.value.reason_code == "template_execution_limit"


def test_lexer_token_limit_precedes_parser_allocation(monkeypatch):
    from jinja2 import Environment

    def forbidden(*_args, **_kwargs):
        pytest.fail("over-limit lexer token stream reached Jinja parser")

    monkeypatch.setattr(Environment, "parse", forbidden)
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(template_graph("{{subject}}" * 173)))
    assert error.value.reason_code == "template_execution_limit"


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("{{subject}}x" * 128, id="ast-nodes-over"),
        pytest.param("{% if subject %}" * 17 + "text" + "{% endif %}" * 17, id="ast-depth-over"),
    ],
)
def test_ast_budgets_refuse_small_but_structurally_excessive_templates(text):
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(template_graph(text)))
    assert error.value.reason_code == "template_execution_limit"


@pytest.mark.parametrize(
    ("text", "want"),
    [
        pytest.param("x" * 16384, "x" * 16384, id="source-ascii-exact"),
        pytest.param("é" * 8192, "é" * 8192, id="source-utf8-exact"),
        pytest.param("{{subject}}x" * 127, "sx" * 127, id="ast-nodes-exact"),
    ],
)
def test_exact_source_and_ast_limits_remain_usable(owned, text, want):
    renderer = renderer_from_factory(owned, text)
    assert renderer.render_template(text, {"subject": "s", "body": ""}) == want


class ExplosiveString(str):  # noqa: FURB189 -- regression needs a str subclass, not UserString
    def __str__(self):
        pytest.fail("custom scalar conversion executed")


@pytest.mark.parametrize(
    "value",
    [
        pytest.param([], id="list"),
        pytest.param({}, id="object"),
        pytest.param(("x",), id="tuple"),
        pytest.param(ExplosiveString("SECRET-VALUE"), id="custom-string"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="infinite"),
        pytest.param(2**53, id="integer-over"),
        pytest.param(-(2**53), id="negative-integer-over"),
        pytest.param("é" * 32769, id="string-utf8-over"),
        pytest.param("\ud800", id="invalid-utf8"),
    ],
)
def test_runtime_renderer_refuses_non_exact_or_over_limit_selected_values(owned, value):
    renderer = renderer_from_factory(owned)
    with pytest.raises(TemplateRenderError) as error:
        renderer.render_template("{{ subject }}", {"subject": value, "body": ""})
    assert "SECRET-VALUE" not in str(error.value)
    assert "\ud800" not in str(error.value)


@pytest.mark.parametrize(
    ("values", "want"),
    [
        pytest.param({"subject": "é" * 32768, "body": ""}, "é" * 32768, id="utf8-output-exact"),
        pytest.param({"subject": 2**53 - 1, "body": ""}, "9007199254740991", id="integer-exact"),
    ],
)
def test_runtime_exact_scalar_and_output_byte_limits(owned, values, want):
    renderer = renderer_from_factory(owned)
    assert renderer.render_template("{{ subject }}", values) == want


def test_output_budget_counts_all_fragments_before_join(owned):
    renderer = renderer_from_factory(owned, "{{subject}}{{body}}")
    with pytest.raises(TemplateRenderError):
        renderer.render_template("{{subject}}{{body}}", {"subject": "é" * 32768, "body": "x"})
    assert receipts(owned) == []


def test_selected_text_aggregate_budget_counts_unused_declared_values(owned):
    renderer = renderer_from_factory(owned, "small", ("subject", "body", "third"))
    with pytest.raises(TemplateRenderError):
        renderer.render_template("small", {"subject": "x" * 65536, "body": "x" * 65536, "third": "x"})
    assert renderer.render_template("small", {"subject": "x" * 65536, "body": "x" * 65536, "third": ""}) == "small"


@pytest.mark.parametrize(
    "error_type", [RecursionError, OverflowError, ValueError], ids=["recursion", "overflow", "value"]
)
def test_parser_failures_are_sanitized_refusals(monkeypatch, error_type):
    from jinja2 import Environment

    def broken(*_args, **_kwargs):
        raise error_type("SECRET-PARSER-TEXT")

    monkeypatch.setattr(Environment, "parse", broken)
    with pytest.raises(BuilderExecutionPolicyError) as error:
        admitted_node_bindings(snapshot(template_graph()))
    assert error.value.reason_code == "unsupported_template_syntax"
    assert "SECRET-PARSER-TEXT" not in str(error.value)


@pytest.mark.parametrize(
    "template",
    [
        pytest.param(r"{{ '\x' }} SECRET-LEXER", id="lexer-string-escape"),
        pytest.param("{% if subject %}SECRET-PARSER", id="parser-unclosed-if"),
    ],
)
def test_malformed_lexer_and_parser_never_rewrite_python_traceback(owned, template):
    from jinja2 import debug

    renderer = renderer_from_factory(owned)
    with pytest.raises(BuilderExecutionPolicyError) as refusal:
        admitted_node_bindings(snapshot(template_graph(template)))
    assert refusal.value.reason_code == "unsupported_template_syntax"
    assert "SECRET-" not in str(refusal.value)
    with pytest.raises(TemplateRenderError) as failure:
        renderer.render_template(template, {"subject": "safe", "body": ""})
    assert "SECRET-" not in str(failure.value)
    # Call-stage assertions make the synthetic Python boundary visible as a
    # behavioral failure even when admission/renderer sanitize its guard error.
    debug.rewrite_traceback_stack.assert_not_called()
    debug.fake_traceback.assert_not_called()


@pytest.mark.parametrize("mutation", ["class", "version", "latest", "raw-config", "binding"])
def test_native_template_class_version_and_raw_binding_are_rechecked(owned, mutation):
    factory, context, _ = prepare_native(
        owned,
        "template_notification.yml",
        inputs={"subject": "Notice", "body": "Body"},
    )
    raw = deepcopy(factory.init_params.graph_config["nodes"][1])
    node_class = TemplateTransformNode
    if mutation == "class":

        class Replacement(TemplateTransformNode):
            pass

        Replacement.__module__ = TemplateTransformNode.__module__
        Replacement.__qualname__ = TemplateTransformNode.__qualname__
        node_class = Replacement
    elif mutation == "binding":
        altered = context.admitted_nodes[1].model_copy(update={"normalized_config_digest": "a" * 64})
        context = context.model_copy(
            update={"admitted_nodes": (context.admitted_nodes[0], altered, context.admitted_nodes[2])}
        )
    elif mutation == "raw-config":
        raw["data"]["template"] = "changed"
    else:
        raw["data"]["version"] = "latest" if mutation == "latest" else "2"
    with pytest.raises(BuilderExecutionPolicyError):
        validate_restricted_raw_node(
            context=context, node_id="template", node_class=node_class, raw_node_data=raw["data"]
        )
    if mutation == "class":
        data = TemplateTransformNode.validate_node_data(factory.init_params.graph_config["nodes"][1]["data"])
        with pytest.raises(BuilderExecutionPolicyError):
            validate_restricted_node(
                context=context, node_id="template", node_class=node_class, resolved_node_data=data
            )
    assert receipts(owned) == []


@pytest.mark.parametrize("entry", ["create", "graph-init", "constructor"])
def test_native_factory_rejects_template_raw_drift_before_native_validator(owned, monkeypatch, entry):
    from core.workflow.node_factory import DifyNodeFactory
    from graphon.graph import Graph

    factory, _, recorder = prepare_native(
        owned,
        "template_notification.yml",
        inputs={"subject": "Notice", "body": "Body"},
    )
    graph = deepcopy(factory.init_params.graph_config)
    graph["nodes"][1]["data"]["template"] = "changed after launch"

    def forbidden(*_args, **_kwargs):
        pytest.fail("raw drift reached concrete native Template validation")

    monkeypatch.setattr(TemplateTransformNode, "validate_node_data", forbidden)

    def invoke():
        if entry == "create":
            return factory.create_node(graph["nodes"][1])
        if entry == "graph-init":
            return Graph.init(graph_config=graph, node_factory=factory, root_node_id="start")
        return DifyNodeFactory(
            factory.init_params.model_copy(update={"graph_config": graph}),
            factory.runtime_state,
            execution_recorder=recorder,
        )

    with pytest.raises(BuilderExecutionPolicyError):
        invoke()
    assert receipts(owned) == []


@pytest.mark.parametrize("names", [("v" * 64,), tuple(f"v{i}" for i in range(32))], ids=["name-exact", "count-exact"])
def test_exact_legal_variable_name_and_count_limits(owned, names):
    renderer = renderer_from_factory(owned, "literal", names)
    assert renderer.render_template("literal", dict.fromkeys(names, "")) == "literal"


def test_native_template_binding_retains_literal_raw_config_digest():
    graph = template_graph()
    binding = admitted_node_bindings(snapshot(graph))[1]
    assert binding.implementation == "graphon.nodes.template_transform.template_transform_node.TemplateTransformNode"
    assert binding.normalized_config_digest == canonical_digest(graph["nodes"][1]["data"])
