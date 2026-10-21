from collections.abc import Iterator, Sequence
from typing import Protocol

from graphon.nodes.base.variable_template_parser import extract_selectors_from_template
from graphon.variables.segments import Segment
from graphon.variables.template_resolution import VARIABLE_PATTERN

type TemplateValue = str | Sequence[str] | int | float | None


class TemplateVariablePool(Protocol):
    def get(self, selector: Sequence[str], /) -> Segment | None: ...


def template_value_selectors(value: TemplateValue) -> Iterator[list[str]]:
    """Extract workflow references from a scalar string or string sequence."""
    values = [value] if isinstance(value, str) else value
    if isinstance(values, Sequence):
        for template in values:
            for reference in extract_selectors_from_template(template):
                yield list(reference.value_selector)


def resolve_template_value(value: TemplateValue, variable_pool: TemplateVariablePool) -> TemplateValue:
    """Resolve scalar values and string sequences against a workflow variable pool.

    A whole scalar reference retains its string or numeric type;
    interpolated text and elements of string lists remain strings. Missing
    references fail explicitly rather than becoming literal selector text.
    """

    def get_segment(selector: str) -> Segment:
        segment = variable_pool.get(selector.split("."))
        if segment is None:
            raise ValueError(f"Workflow variable {selector} is not available.")
        return segment

    def resolve_template(template: str) -> str | int | float | None:
        if match := VARIABLE_PATTERN.fullmatch(template):
            resolved = get_segment(match.group(1)).to_object()
            if resolved is None or isinstance(resolved, str | float):
                return resolved
            if isinstance(resolved, int) and not isinstance(resolved, bool):
                return resolved
            return str(resolved)
        return VARIABLE_PATTERN.sub(lambda match: get_segment(match.group(1)).text, template)

    if isinstance(value, str):
        return resolve_template(value)
    if isinstance(value, Sequence):
        return [str(resolve_template(item)) for item in value]
    return value
