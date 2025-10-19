import logging
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

_tokenizer: Any | None = None
_lock = Lock()


class GPT2Tokenizer:
    @staticmethod
    def _get_num_tokens_by_gpt2(text: str) -> int:
        """
        use gpt2 tokenizer to get num tokens
        """
        _tokenizer = GPT2Tokenizer.get_encoder()
        tokens = _tokenizer.encode(text)  # type: ignore
        return len(tokens)

    @staticmethod
    def get_num_tokens(text: str) -> int:
        # Because this process needs more cpu resource, we turn this back before we find a better way to handle it.
        #
        # future = _executor.submit(GPT2Tokenizer._get_num_tokens_by_gpt2, text)
        # result = future.result()
        # return cast(int, result)
        return GPT2Tokenizer._get_num_tokens_by_gpt2(text)

    @staticmethod
    def get_encoder():
        global _tokenizer, _lock
        if _tokenizer is not None:
            return _tokenizer
        with _lock:
            if _tokenizer is None:
                # Try to use tiktoken to get the tokenizer because it is faster
                #
                try:
                    import tiktoken

                    _tokenizer = tiktoken.get_encoding("gpt2")
                except Exception:
                    from os.path import abspath, dirname, join

                    from transformers import GPT2Tokenizer as TransformerGPT2Tokenizer

                    base_path = abspath(__file__)
                    gpt2_tokenizer_path = join(dirname(base_path), "gpt2")
                    _tokenizer = TransformerGPT2Tokenizer.from_pretrained(gpt2_tokenizer_path)
                    logger.info("Fallback to Transformers' GPT-2 tokenizer from tiktoken")

            return _tokenizer
