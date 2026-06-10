from collections.abc import Collection


def convert_to_lower_and_upper_set(inputs: Collection[str]) -> set[str]:
    """
    Convert a collection of strings to a set containing both lower and upper case versions of each string.

    Args:
        inputs (Collection[str]): A collection of strings to be converted.

    Returns:
        set[str]: A set containing both lower and upper case versions of each string.
    """
    if not inputs:
        return set()
    else:
        return {case for s in inputs if s for case in (s.lower(), s.upper())}
