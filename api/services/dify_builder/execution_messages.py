"""Finite sanitized execution-refusal copy; no graph/input/error interpolation."""

FALLBACK = "Execution safety requires review or revised test inputs; automatic repair and publication are blocked."
_BLOCKED = " Automatic repair and publication are blocked."
_MESSAGES = {
    "unsupported_node_implementation": (
        "Builder does not yet have safe-test support for a node in this workflow. "
        "The draft can still be edited; this test did not run." + _BLOCKED
    ),
    "unsupported_json_tool_configuration": (
        "Builder cannot safely test this Tool configuration yet. Use the qualified JSON Parse setup with string "
        "inputs and an explicit Ensure ASCII value, or keep editing the draft. This test did not run." + _BLOCKED
    ),
    "unsupported_json_credentials": (
        "Builder cannot safely test this Tool configuration yet. Use the qualified JSON Parse setup without "
        "credentials, or keep editing the draft. This test did not run." + _BLOCKED
    ),
    "unsupported_json_content_constant": (
        "Put this JSON content in a Start string input and bind it directly to JSON Parse. "
        "Content constants containing dots or template markers are not covered by safe testing. "
        "This test did not run." + _BLOCKED
    ),
    "unsupported_json_filter": (
        "Use a supported JSONPath selection in JSON Parse, or keep editing the draft. This test did not run." + _BLOCKED
    ),
    "unsupported_json_selector": (
        "Bind JSON Parse text from a declared Start string input, or keep editing the draft. "
        "This test did not run." + _BLOCKED
    ),
    "invalid_json_parameters": (
        "Set JSON Parse content and filter to strings and Ensure ASCII to an explicit boolean value. "
        "This test did not run." + _BLOCKED
    ),
    "json_execution_limit": (
        "Reduce JSON Parse input or output to fit safe testing limits; this test did not run." + _BLOCKED
    ),
    "installed_json_tool_unavailable": (
        "Install the qualified JSON Process version before testing; this test did not run." + _BLOCKED
    ),
    "unsupported_json_tool_installation": (
        "Install the qualified JSON Process version before testing; this test did not run." + _BLOCKED
    ),
    "json_tool_installation_changed": (
        "The installed JSON Process version changed. Refresh the Tool setup and test again; this test did not run."
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
