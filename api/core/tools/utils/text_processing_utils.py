import re


def remove_leading_symbols(text: str) -> str:
    """
    Remove leading punctuation or symbols from the given text.
    Preserves markdown links like [text](url) at the start.

    Args:
        text (str): The input text to process.

    Returns:
        str: The text with leading punctuation or symbols removed.
    """
    # Check if text starts with a markdown link - preserve it
    markdown_link_pattern = r"^\[([^\]]+)\]\((https?://[^)]+)\)"
    if re.match(markdown_link_pattern, text):
        return text

    # Match Unicode ranges for punctuation and symbols
    # FIXME this pattern is confused quick fix for #11868 maybe refactor it later
    pattern = r'^[\[\]\u2000-\u2025\u2027-\u206F\u2E00-\u2E7F\u3000-\u300F\u3011-\u303F"#$%&\'()*+,./:;<=>?@^_`~]+'
    return re.sub(pattern, "", text)
