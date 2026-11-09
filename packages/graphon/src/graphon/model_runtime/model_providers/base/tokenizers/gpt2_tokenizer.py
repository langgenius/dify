import logging
from abc import abstractmethod
from collections.abc import Sequence
from pathlib import Path
from threading import Lock
from typing import Protocol

logger = logging.getLogger(__name__)


class _TokenizerProtocol(Protocol):
    @abstractmethod
    def encode(self, text: str) -> Sequence[int]: ...


def _try_load_tiktoken_encoder() -> _TokenizerProtocol | None:
    try:
        import tiktoken  # ruff:ignore[import-outside-top-level]

        return tiktoken.get_encoding("gpt2")
    except Exception:
        logger.debug(
            "Failed to initialize tiktoken GPT-2 tokenizer; falling back",
            exc_info=True,
        )
        return None


class GPT2Tokenizer:
    def __init__(self) -> None:
        self._encoder: _TokenizerProtocol | None = None
        self._lock = Lock()

    def get_num_tokens(self, text: str) -> int:
        return len(self.get_encoder().encode(text))

    def get_encoder(self) -> _TokenizerProtocol:
        if self._encoder is not None:
            return self._encoder
        with self._lock:
            if self._encoder is None:
                # Try to use tiktoken to get the tokenizer because it is faster
                self._encoder = _try_load_tiktoken_encoder()
                if self._encoder is None:
                    import transformers  # ruff:ignore[import-outside-top-level]

                    gpt2_tokenizer_path = Path(__file__).resolve().parent / "gpt2"
                    self._encoder = transformers.GPT2Tokenizer.from_pretrained(
                        str(gpt2_tokenizer_path),
                    )
                    logger.info(
                        "Fallback to Transformers' GPT-2 tokenizer from tiktoken",
                    )

            return self._encoder
