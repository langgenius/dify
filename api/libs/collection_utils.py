def convert_to_lower_and_upper_set(inputs: list[str] | set[str]) -> set[str]:
    """Convert a list or set of strings to a set containing both lower and upper case versions of each string.

    Args:
        inputs (list[str] | set[str]): A list or set of strings to be converted.

    Returns:
        set[str]: A set containing both lower and upper case versions of each string.
    """
    if not inputs:
        return set()
    inputs = {s for s in inputs if s}
    lowers = {s.lower() for s in inputs}
    uppers = {s.upper() for s in inputs}
    result = lowers | uppers
    return result
