"""Utility functions for workflow variable handling."""

from collections.abc import Sequence

from core.file.models import File
from core.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment
from core.workflow.runtime import VariablePool


def fetch_files(variable_pool: VariablePool, selector: Sequence[str]) -> Sequence[File]:
    """Fetch files from a variable selector.

    This function provides a unified way to fetch files from the variable pool,
    used by both LLM and Agent nodes for consistent file handling.

    Args:
        variable_pool: The variable pool to fetch from.
        selector: The variable selector path (e.g., ["sys", "files"]).

    Returns:
        A sequence of File objects. Returns an empty list if:
        - The variable doesn't exist
        - The variable is None
        - The variable is an empty array
        - The variable type is not supported for file extraction
    """
    variable = variable_pool.get(list(selector))
    if variable is None:
        return []
    elif isinstance(variable, FileSegment):
        return [variable.value]
    elif isinstance(variable, ArrayFileSegment):
        return variable.value
    elif isinstance(variable, (NoneSegment, ArrayAnySegment)):
        return []
    # For unexpected variable types, return empty list to maintain robustness
    return []
