"""Exact citation-display metadata for the restricted standard Workflow profile.

This flag presents existing citation metadata; it grants no retrieval or node
capability. The caller retains raw revision binding and legacy disabled shapes.
"""


def is_citation_display_metadata(value: object) -> bool:
    """Only the native boolean display flag, without coercion or normalization."""
    return type(value) is dict and set(value) == {"enabled"} and type(value["enabled"]) is bool
