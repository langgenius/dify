import re


def remove_leading_symbols(text: str) -> str:
    """
    Remove leading punctuation or symbols from the given text.

    Args:
        text (str): The input text to process.

    Returns:
        str: The text with leading punctuation or symbols removed.
    """
    # Match Unicode ranges for punctuation and symbols
    # FIXME this pattern is confused quick fix for #11868 maybe refactor it later
    pattern = r"^[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F!\"#$%&'()*+,./:;<=>?@^_`~]+"
    return re.sub(pattern, "", text)
