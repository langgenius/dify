from typing import Optional

import tiktoken


def num_tokens(string: Optional[str]) -> int:
    if not string:
        return 0
    encoding = tiktoken.get_encoding("cl100k_base")
    return len(encoding.encode(string))
