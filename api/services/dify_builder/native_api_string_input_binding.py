"""Keep generated native API text inputs in the shared string editor's format.

Only public string/llm declarations and exact Start string selectors prove this
conversion. Existing drafts, unknown sources and other typed inputs are untouched.
The caller supplies its existing placeholder grammar; no runtime lookup occurs.
"""

from collections import Counter
from collections.abc import Mapping, Sequence
from re import Pattern
from typing import cast

from services.dify_builder.native_api_output_contract import is_native_api_tool

_START_STRING_TYPES = frozenset({"text-input", "paragraph", "select"})


def normalize_native_api_string_bindings(
    *,
    tool_data: Mapping[str, object],
    nodes: Sequence[Mapping[str, object]],
    parameters: Sequence[Mapping[str, object]],
    placeholder_pattern: Pattern[str],
) -> dict[str, object]:
    """Return bindings with proven direct Start strings encoded as mixed text.

    Equivalence concerns present string values. Native mixed rendering already
    differs from variable lookup for absent/null pool values; this owner neither
    changes those runtime semantics nor infers types of other node outputs.
    Sources, declarations and original binding objects are never mutated.
    """
    raw = tool_data.get("tool_parameters")
    bindings = dict(cast(Mapping[str, object], raw)) if isinstance(raw, Mapping) else {}
    if not is_native_api_tool(tool_data):
        return bindings

    node_counts = Counter(node.get("id") for node in nodes if isinstance(node.get("id"), str))
    string_selectors: set[tuple[str, str]] = set()
    for node in nodes:
        node_id, data = node.get("id"), node.get("data")
        if not isinstance(node_id, str) or node_counts[node_id] != 1 or not isinstance(data, Mapping):
            continue
        if data.get("type") != "start" or not isinstance(data.get("variables"), list):
            continue
        variables = [item for item in cast(list[object], data["variables"]) if isinstance(item, Mapping)]
        counts = Counter(item.get("variable") for item in variables if isinstance(item.get("variable"), str))
        for variable in variables:
            name = variable.get("variable")
            kind = variable.get("type")
            if isinstance(name, str) and counts[name] == 1 and isinstance(kind, str) and kind in _START_STRING_TYPES:
                string_selectors.add((node_id, name))

    parameter_counts = Counter(item.get("name") for item in parameters if isinstance(item.get("name"), str))
    for parameter in parameters:
        name = parameter.get("name")
        if (
            not isinstance(name, str)
            or parameter_counts[name] != 1
            or parameter.get("type") != "string"
            or parameter.get("form") != "llm"
        ):
            continue
        binding = bindings.get(name)
        if not isinstance(binding, Mapping) or binding.get("type") != "variable":
            continue
        selector = binding.get("value")
        if not isinstance(selector, list) or len(selector) != 2 or not all(isinstance(part, str) for part in selector):
            continue
        source_id, field = cast(list[str], selector)
        # A dot inside the direct field would become a different nested selector
        # when the native template resolver splits its placeholder on dots.
        if "." in field or (source_id, field) not in string_selectors:
            continue
        placeholder = "{{#" + source_id + "." + field + "#}}"
        if placeholder_pattern.fullmatch(placeholder) is not None:
            bindings[name] = {**binding, "type": "mixed", "value": placeholder}
    return bindings
