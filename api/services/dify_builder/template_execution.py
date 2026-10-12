"""Pure, finite text interpretation for Builder's existing native Template node.

Jinja supplies only its lexer and parser. No compilation, rendering, globals,
extensions or effectful collaborator is used. Admission inspects every branch;
the native adapter repeats inspection and bounds all selected values and output.
"""

import math
import re
from collections.abc import Iterator, Mapping
from typing import Any, NoReturn, override

from jinja2 import Environment, nodes

from core.dify_builder.execution_policy import BuilderExecutionPolicyError
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError

MAX_SOURCE_BYTES = 16384
MAX_TOKENS = 512
MAX_AST_NODES = 256
MAX_AST_DEPTH = 16
MAX_VARIABLES = 32
MAX_TEXT_BYTES = 65536
MAX_SELECTED_BYTES = 131072
MAX_OUTPUT_BYTES = 65536
MAX_VISITS = 512
MAX_INTEGER = 2**53 - 1

Scalar = str | bool | int | float | None
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}\Z", re.ASCII)
_FIELDS = {
    nodes.Template: ("body",),
    nodes.Output: ("nodes",),
    nodes.TemplateData: ("data",),
    nodes.If: ("test", "body", "elif_", "else_"),
    nodes.Name: ("name", "ctx"),
    nodes.Const: ("value",),
    nodes.Filter: ("node", "name", "args", "kwargs", "dyn_args", "dyn_kwargs"),
    nodes.And: ("left", "right"),
    nodes.Or: ("left", "right"),
    nodes.Not: ("node",),
}


def _refuse(reason: str = "unsupported_template_syntax") -> NoReturn:
    raise BuilderExecutionPolicyError(reason)


def _text_bytes(value: object, limit: int) -> int:
    """Bound character count before allocating any UTF-8 representation."""
    if type(value) is not str:
        _refuse("unsupported_template_configuration")
    if len(value) > limit:
        _refuse("template_execution_limit")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        _refuse("unsupported_template_configuration")
    if size > limit:
        _refuse("template_execution_limit")
    return size


def validate_template_source(template: object) -> None:
    """Cheap preflight, including before an existing caller's graph digest."""
    _text_bytes(template, MAX_SOURCE_BYTES)


def _names(values: object) -> frozenset[str]:
    if not isinstance(values, (list, tuple)) or len(values) > MAX_VARIABLES:
        _refuse("unsupported_template_configuration")
    names: set[str] = set()
    for name in values:
        if type(name) is not str or not _NAME.fullmatch(name) or name in names:
            _refuse("unsupported_template_configuration")
        names.add(name)
    return frozenset(names)


def _scalar(value: object) -> Scalar:
    """Exact built-ins only: no custom conversion/truthiness can execute."""
    if value is None or type(value) is bool:
        return value
    if type(value) is str:
        _text_bytes(value, MAX_TEXT_BYTES)
        return value
    if type(value) is int:
        if not -MAX_INTEGER <= value <= MAX_INTEGER:
            _refuse("template_execution_limit")
        return value
    if type(value) is float and math.isfinite(value):
        return value
    _refuse("unsupported_template_configuration")


def _scalar_text(value: Scalar) -> str:
    # Values are checked before this conversion, including scalar constants.
    return value if type(value) is str else str(value)


def _children(node: nodes.Node, declared: frozenset[str]) -> Iterator[nodes.Node]:
    """Validate every field, yielding only the reviewed structural children."""
    kind = type(node)
    if kind not in _FIELDS or node.fields != _FIELDS[kind]:
        _refuse()
    if kind is nodes.Name:
        if node.ctx != "load" or node.name not in declared:
            _refuse()
        return
    if kind is nodes.Const:
        try:
            _scalar(node.value)
        except BuilderExecutionPolicyError:
            _refuse()
        return
    if kind is nodes.TemplateData:
        _text_bytes(node.data, MAX_SOURCE_BYTES)
        return
    if kind is nodes.Filter:
        if node.name != "trim" or node.args or node.kwargs or node.dyn_args is not None or node.dyn_kwargs is not None:
            _refuse()
        if node.node is None:
            _refuse()
        yield node.node
        return
    for field in _FIELDS[kind]:
        value = getattr(node, field)
        if isinstance(value, nodes.Node):
            yield value
        elif type(value) is list:
            for child in value:
                if not isinstance(child, nodes.Node):
                    _refuse()
                yield child
        else:
            _refuse()


def inspect_template(template: str, declared: frozenset[str]) -> nodes.Template:
    """Refuse before parsing on source/token bounds, then inspect iteratively."""
    validate_template_source(template)
    try:
        environment = Environment()
        for count, _token in enumerate(environment.lex(template), 1):
            if count > MAX_TOKENS:
                _refuse("template_execution_limit")
        parsed = environment.parse(template)
        pending: list[tuple[nodes.Node, int]] = [(parsed, 0)]
        visited = 0
        while pending:
            node, depth = pending.pop()
            visited += 1
            if visited > MAX_AST_NODES or depth > MAX_AST_DEPTH:
                _refuse("template_execution_limit")
            for child in _children(node, declared):
                # Bound the work stack as well as total visited nodes.
                if visited + len(pending) >= MAX_AST_NODES:
                    _refuse("template_execution_limit")
                pending.append((child, depth + 1))
        return parsed
    except BuilderExecutionPolicyError:
        raise
    except Exception:
        # Parser/lexer/AST failures, including recursion/overflow, never echo source.
        _refuse()


def validate_template_configuration(data: Mapping[str, Any]) -> None:
    """Raw names/selectors must be safe before permissive native DTO parsing."""
    template, variables = data.get("template"), data.get("variables")
    validate_template_source(template)
    # A render failure must remain a native failure, not a default-value branch.
    if data.get("error_strategy") not in (None, "") or data.get("default_value") not in (None, []):
        _refuse("unsupported_template_configuration")
    if data.get("default_values") not in (None, []):
        _refuse("unsupported_template_configuration")
    retry = data.get("retry_config")
    if retry is not None and (
        type(retry) is not dict
        or set(retry) - {"retry_enabled", "max_retries", "retry_interval"}
        or retry.get("retry_enabled", False) is not False
        or any(
            type(retry.get(key, 0)) is not int or not 0 <= retry.get(key, 0) <= MAX_INTEGER
            for key in ("max_retries", "retry_interval")
        )
    ):
        _refuse("unsupported_template_configuration")
    if type(variables) is not list or len(variables) > MAX_VARIABLES:
        _refuse("unsupported_template_configuration")
    names = []
    for variable in variables:
        if type(variable) is not dict or set(variable) != {"variable", "value_selector"}:
            _refuse("unsupported_template_configuration")
        selector = variable["value_selector"]
        if (
            not isinstance(selector, (list, tuple))
            or len(selector) != 2
            or any(type(part) is not str or not part for part in selector)
        ):
            _refuse("unsupported_template_selector")
        names.append(variable["variable"])
    inspect_template(template, _names(names))


class _Evaluation:
    """One bounded invocation, with cumulative append and visit accounting."""

    def __init__(self, values: dict[str, Scalar]) -> None:
        self.values = values
        self.visits = 0
        self.output_bytes = 0
        self.fragments: list[str] = []

    def _visit(self) -> None:
        if self.visits >= MAX_VISITS:
            _refuse("template_execution_limit")
        self.visits += 1

    def expression(self, node: nodes.Node) -> Scalar:
        self._visit()
        kind = type(node)
        if kind is nodes.Name:
            return self.values[node.name]
        if kind is nodes.Const:
            return node.value
        if kind is nodes.TemplateData:
            return node.data
        if kind is nodes.Filter:
            return _scalar_text(self.expression(node.node)).strip()
        if kind is nodes.Not:
            return not self.expression(node.node)
        if kind is nodes.And:
            left = self.expression(node.left)
            return self.expression(node.right) if left else left
        if kind is nodes.Or:
            left = self.expression(node.left)
            return left or self.expression(node.right)
        _refuse()

    def statement(self, node: nodes.Node) -> None:
        self._visit()
        kind = type(node)
        if kind is nodes.Template:
            for child in node.body:
                self.statement(child)
        elif kind is nodes.Output:
            for expression in node.nodes:
                text = _scalar_text(self.expression(expression))
                size = _text_bytes(text, MAX_OUTPUT_BYTES - self.output_bytes)
                self.output_bytes += size
                self.fragments.append(text)
        elif kind is nodes.If:
            branch = node.else_
            if self.expression(node.test):
                branch = node.body
            else:
                for alternative in node.elif_:
                    self._visit()
                    if self.expression(alternative.test):
                        branch = alternative.body
                        break
            for child in branch:
                self.statement(child)
        else:
            _refuse()


class BoundedJinja2TemplateRenderer(Jinja2TemplateRenderer):
    """Native nominal adapter; never delegates to ordinary Jinja rendering."""

    @override
    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        try:
            if type(variables) is not dict or len(variables) > MAX_VARIABLES:
                _refuse("unsupported_template_configuration")
            declared = _names(tuple(variables))
            values: dict[str, Scalar] = {}
            selected_bytes = 0
            for name, raw in variables.items():
                value = _scalar(raw)
                text = _scalar_text(value)
                selected_bytes += _text_bytes(text, MAX_SELECTED_BYTES - selected_bytes)
                values[name] = value
            parsed = inspect_template(template, declared)
            evaluation = _Evaluation(values)
            evaluation.statement(parsed)
            return "".join(evaluation.fragments)
        except BuilderExecutionPolicyError as error:
            if error.reason_code == "template_execution_limit":
                raise TemplateRenderError("Template rendering exceeded safe testing size limits.") from None
            raise TemplateRenderError("Template rendering refused unsupported syntax or scalar inputs.") from None
        except Exception:
            raise TemplateRenderError("Template rendering failed safely; review the template and inputs.") from None
