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
    pattern = re.compile(
        r"""
        ^
        (?:
            [\u2000-\u2025]                # General Punctuation: spaces, quotes, dashes
          | [\u2027-\u206F]                # General Punctuation: ellipsis, underscores, etc.
          | [\u2E00-\u2E7F]                # Supplemental Punctuation: medieval, ancient marks
          | [\u3000-\u300F]                # CJK Punctuation: 、。〃「」『》』 (excludes 【】)
          | [\u3012-\u303F]                # CJK Punctuation: 〖〗〔〕〘〙〚〛〜 etc.
          | ["#$%&'()*+,./:;<=>?@^_`~]     # ASCII punctuation (excludes []【】)
        )+
        """,
        re.VERBOSE,
    )
    return re.sub(pattern, "", text)
