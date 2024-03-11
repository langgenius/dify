from os.path import abspath, dirname, join
from threading import Lock

from transformers import AutoTokenizer


class JinaTokenizer:
    _tokenizer = None
    _lock = Lock()

    @classmethod
    def _get_tokenizer(cls):
        if cls._tokenizer is None:
            with cls._lock:
                if cls._tokenizer is None:
                    base_path = abspath(__file__)
                    gpt2_tokenizer_path = join(dirname(base_path), 'tokenizer')
                    cls._tokenizer = AutoTokenizer.from_pretrained(gpt2_tokenizer_path)
        return cls._tokenizer

    @classmethod
    def _get_num_tokens_by_jina_base(cls, text: str) -> int:
        """
            use jina tokenizer to get num tokens
        """
        tokenizer = cls._get_tokenizer()
        tokens = tokenizer.encode(text)
        return len(tokens)
    
    @classmethod
    def get_num_tokens(cls, text: str) -> int:
        return cls._get_num_tokens_by_jina_base(text)