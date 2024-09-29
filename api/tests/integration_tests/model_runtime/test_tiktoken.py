import os

import tiktoken

from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer


def test_tiktoken():
    os.environ["TIKTOKEN_CACHE_DIR"] = "/tmp/.tiktoken_cache"
    GPT2Tokenizer.get_num_tokens("Hello, world!")
    assert tiktoken.registry.ENCODING_CONSTRUCTORS is not None
