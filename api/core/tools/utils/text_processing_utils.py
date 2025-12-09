import re


def remove_leading_symbols(text: str) -> str:
    """
    Remove leading punctuation or symbols from the given text.

    Args:
        text (str): The input text to process.

    Returns:
        str: The text with leading punctuation or symbols removed.
    """
    # 移除了感叹号 '!' 原逻辑会错误地将 Markdown 图像语法 ![]() 中的前导 ![' 符号移除，导致输出的 Markdown 格式不完整，图片无法正常显示
    # Removed the exclamation mark '!' The original logic would mistakenly remove the leading '!' symbol in the Markdown image syntax ![](), resulting in incomplete Markdown formatting and images that cannot be displayed properly.
    pattern = r"^[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\"#$%&'()*+,./:;<=>?@^_`~]+"
    return re.sub(pattern, "", text)
