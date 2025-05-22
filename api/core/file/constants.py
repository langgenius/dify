from typing import Any

FILE_MODEL_IDENTITY = "__dify__file__"

# DUMMY_OUTPUT_IDENTITY is a placeholder output for workflow nodes.
# Its sole possible value is `None`.
#
# This is used to signal the execution of a workflow node when it has no other outputs.
_DUMMY_OUTPUT_IDENTITY = "__dummy__"
_DUMMY_OUTPUT_VALUE: None = None


def add_dummy_output(original: dict[str, Any] | None) -> dict[str, Any]:
    if original is None:
        original = {}
    original[_DUMMY_OUTPUT_IDENTITY] = _DUMMY_OUTPUT_VALUE
    return original


def is_dummy_output_variable(name: str) -> bool:
    return name == _DUMMY_OUTPUT_IDENTITY
