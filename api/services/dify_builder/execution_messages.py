"""Finite sanitized execution-refusal copy; no graph/input/error interpolation."""

FALLBACK = "Execution safety requires review or revised test inputs; automatic repair and publication are blocked."
_BLOCKED = " Automatic repair and publication are blocked."
_MESSAGES = {
    "unsupported_node_implementation": (
        "This node is not supported by safe testing. Edit the workflow to use supported nodes; the test did not run."
        + _BLOCKED
    ),
    "unsupported_template_syntax": (
        "Template supports scalar text, if/elif/else, and trim. Edit unsupported syntax; the test did not run."
        + _BLOCKED
    ),
    "unsupported_template_configuration": (
        "Edit Template variables to use unique legal names and complete selectors; the test did not run." + _BLOCKED
    ),
    "unsupported_template_selector": (
        "Use Template inputs from Start scalars, earlier Template output or HTTP body; the test did not run." + _BLOCKED
    ),
    "template_execution_limit": (
        "Reduce Template size or selected text to fit safe testing limits; the test did not run." + _BLOCKED
    ),
}
STATIC_COPY = frozenset({FALLBACK, *_MESSAGES.values()})


def execution_refusal_message(reason_code: str) -> str:
    return _MESSAGES.get(reason_code, FALLBACK)
