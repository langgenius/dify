"""Builder reference policy for the native ApiTool message envelope.

The native implementation emits JSON/text messages, never named response fields.
Its HTTP response declaration and model-generated output_schema therefore cannot
expand the node's outputs. Legacy or unknown tool identities retain the generator's
existing dynamic-output handling; this owner performs no metadata/runtime lookup.
"""

from collections.abc import Mapping, Sequence
from re import Pattern
from typing import cast
from uuid import UUID

_NATIVE_OUTPUTS = frozenset({"text", "json", "files"})
_SELECTOR_FIELDS = frozenset({"value_selector", "variable_selector"})
_NODE_SELECTOR_FIELDS = {
    "iteration": ("iterator_selector", "output_selector"),
    "knowledge-retrieval": ("query_variable_selector", "query_attachment_selector"),
    "question-classifier": ("query_variable_selector",),
    "list-operator": ("variable",),
    "parameter-extractor": ("query",),
    "assigner": ("assigned_variable_selector", "input_variable_selector"),
}
_AGGREGATOR_TYPES = frozenset({"variable-aggregator", "variable-assigner"})
# Declaration/default subtrees and literal values remain data even when a
# business object happens to contain a key that looks like a selector field.
_NON_REFERENCE_FIELDS = frozenset(
    {
        "value",
        "default",
        "options",
        "allowed_file_types",
        "allowed_file_extensions",
        "allowed_file_upload_methods",
        "structured_output",
        "required",
        "enum",
        "type",
        "output_schema",
        "input_schema",
        "parameter_schema",
        "paramSchemas",
        "schema",
        "metadata",
        "tool_configurations",
        "example",
        "examples",
    }
)


def is_native_api_tool(data: Mapping[str, object]) -> bool:
    """Recognize the native API identity carried by catalogue-hydrated nodes."""
    if data.get("type") != "tool" or data.get("provider_type") != "api":
        return False
    provider_id = data.get("provider_id")
    if not isinstance(provider_id, str):
        return False
    try:
        return str(UUID(provider_id)) == provider_id
    except ValueError:
        return False


def declares_native_api_output(variable: str) -> bool:
    """Only whole native envelopes are referenceable; parse their values in Code.

    ``text`` is scalar and ``json``/``files`` are arrays. A business root or a
    dotted/index path cannot become a named output through a response schema.
    """
    return variable in _NATIVE_OUTPUTS


def native_api_output_error_hint() -> str:
    """Return an actionable static hint without provider labels or input values."""
    return (
        "; native api tools expose only the standard roots text, files, json. "
        "The json output is an array of message payloads, not named response fields; text is scalar. "
        "Pass the whole json or text envelope to a native Code node, explicitly parse and validate "
        "the response there, and declare typed outputs before consuming business fields."
    )


def collect_native_api_selector_refs(
    nodes: Sequence[Mapping[str, object]], *, placeholder_pattern: Pattern[str]
) -> set[tuple[str, str]]:
    """Collect authoritative references for known native API producers.

    Only selector fields and typed variable input values prove that a list is a
    reference. Real placeholders outside literal/declaration subtrees use the
    caller's existing runtime-matching pattern, preserving its syntax protocol.
    Callers replace generic refs to known API producers with this set; other
    providers retain the generic walk. This also deduplicates error references.
    No Code execution, credential inspection, or metadata lookup occurs here.
    """
    known_ids: set[str] = set()
    for node in nodes:
        node_id = node.get("id")
        data = node.get("data")
        if isinstance(node_id, str) and isinstance(data, Mapping):
            if is_native_api_tool(cast(Mapping[str, object], data)):
                known_ids.add(node_id)
    refs: set[tuple[str, str]] = set()

    def collect_selector(value: object) -> None:
        if not isinstance(value, list) or len(value) < 2:
            return
        if not all(isinstance(part, str) for part in value):
            return
        selector = [part.strip() for part in cast(list[str], value)]
        if selector[0] in known_ids and all(selector):
            refs.add((selector[0], ".".join(selector[1:])))

    def walk(value: object) -> None:
        if isinstance(value, str):
            for match in placeholder_pattern.finditer(value):
                node_id, variable = match.group(1).strip(), match.group(2).strip()
                if node_id in known_ids and variable:
                    refs.add((node_id, variable))
        elif isinstance(value, Mapping):
            fields = cast(Mapping[str, object], value)
            if fields.get("type") == "constant":
                return
            for name in _SELECTOR_FIELDS:
                if name in fields:
                    collect_selector(fields[name])
            if fields.get("type") == "variable":
                collect_selector(fields.get("value"))
            for name, item in fields.items():
                if name == "value":
                    # Runtime comparisons and rendered body/input fields use
                    # string templates. Arrays/objects and typed constants stay data.
                    if (
                        isinstance(item, str)
                        and fields.get("input_type") != "constant"
                        and fields.get("value_type") != "constant"
                    ):
                        walk(item)
                    continue
                if fields.get("type") == "code" and name == "code":
                    # Python source is static; Code inputs use declared selectors.
                    continue
                if fields.get("type") == "llm" and name == "context":
                    if not isinstance(item, Mapping) or not item.get("enabled"):
                        continue
                if fields.get("type") in ("llm", "question-classifier", "parameter-extractor") and name == "vision":
                    if not isinstance(item, Mapping) or not item.get("enabled"):
                        continue
                if fields.get("type") == "http-request" and name == "body":
                    # Body references are selected by the active HTTP body branch.
                    continue
                if fields.get("type") == "list-operator" and name == "filter_by":
                    if not isinstance(item, Mapping) or not item.get("enabled"):
                        continue
                if name in _NON_REFERENCE_FIELDS:
                    continue
                if name == "outputs" and isinstance(item, Mapping):
                    # Code outputs are declarations; End outputs are selector lists.
                    continue
                if fields.get("type") == "start" and name == "variables":
                    continue
                if fields.get("type") in ("variable-aggregator", "variable-assigner") and name in {
                    "variables",
                    "advanced_settings",
                }:
                    continue
                if fields.get("type") == "human-input" and name == "inputs":
                    continue
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    def mapping_items(value: object) -> list[Mapping[str, object]]:
        if not isinstance(value, list):
            return []
        return [cast(Mapping[str, object], item) for item in value if isinstance(item, Mapping)]

    def collect_selector_list(value: object) -> None:
        if isinstance(value, list):
            for selector in value:
                collect_selector(selector)

    def collect_runtime_fields(data: Mapping[str, object]) -> None:
        node_type = data.get("type")
        if not isinstance(node_type, str):
            return
        for name in _NODE_SELECTOR_FIELDS.get(node_type, ()):
            collect_selector(data.get(name))
        if node_type in _AGGREGATOR_TYPES:
            settings = data.get("advanced_settings")
            if isinstance(settings, Mapping) and settings.get("group_enabled"):
                for group in mapping_items(settings.get("groups")):
                    collect_selector_list(group.get("variables"))
            else:
                collect_selector_list(data.get("variables"))
        elif node_type == "human-input":
            # StringSource/StringListSource retain their old constant value when
            # switched to variable mode. Only the active selector is a reference.
            for form_input in mapping_items(data.get("inputs")):
                source = None
                if form_input.get("type") == "paragraph":
                    source = form_input.get("default")
                elif form_input.get("type") == "select":
                    source = form_input.get("option_source")
                if isinstance(source, Mapping) and source.get("type") == "variable":
                    collect_selector(source.get("selector"))
        elif node_type == "assigner":
            for item in mapping_items(data.get("items")):
                if item.get("input_type") == "variable":
                    collect_selector(item.get("value"))
        elif node_type == "loop":
            for variable in mapping_items(data.get("loop_variables")):
                if variable.get("value_type") == "variable":
                    collect_selector(variable.get("value"))
        elif node_type == "http-request":
            body = data.get("body")
            if isinstance(body, Mapping):
                body_type = body.get("type")
                entries = mapping_items(body.get("data"))
                if body_type == "binary":
                    if len(entries) == 1:
                        collect_selector(entries[0].get("file"))
                elif body_type in ("json", "raw-text", "x-www-form-urlencoded", "form-data"):
                    if body_type in ("json", "raw-text"):
                        entries = entries[:1]
                    for entry in entries:
                        key = entry.get("key")
                        if isinstance(key, str):
                            walk(key)
                        if body_type == "form-data" and entry.get("type") != "text":
                            collect_selector(entry.get("file"))
                        else:
                            value = entry.get("value")
                            if isinstance(value, str):
                                walk(value)
        elif node_type in ("tool", "agent"):
            parameters = data.get("tool_parameters" if node_type == "tool" else "agent_parameters")
            if isinstance(parameters, Mapping):
                for binding in parameters.values():
                    if isinstance(binding, Mapping) and binding.get("type") in ("mixed", "constant"):
                        value = binding.get("value")
                        # Tool/Agent render mixed and constant string inputs.
                        # Literal array/object contents are not selectors.
                        if isinstance(value, str):
                            walk(value)

    for node in nodes:
        data = node.get("data")
        if isinstance(data, Mapping):
            collect_runtime_fields(cast(Mapping[str, object], data))
            walk(data)
    return refs
