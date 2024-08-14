import re
from collections.abc import Generator
from typing import Any, Literal, Optional, Union

from _pytest.monkeypatch import MonkeyPatch
from huggingface_hub import InferenceClient
from huggingface_hub.inference._text_generation import (
    Details,
    StreamDetails,
    TextGenerationResponse,
    TextGenerationStreamResponse,
    Token,
)
from huggingface_hub.utils import BadRequestError


class MockHuggingfaceChatClass:
    @staticmethod
    def generate_create_sync(model: str) -> TextGenerationResponse:
        response = TextGenerationResponse(
            generated_text="You can call me Miku Miku o~e~o~",
            details=Details(
                finish_reason="length",
                generated_tokens=6,
                tokens=[
                    Token(id=0, text="You", logprob=0.0, special=False) for i in range(0, 6)
                ]
            )
        )

        return response

    @staticmethod
    def generate_create_stream(model: str) -> Generator[TextGenerationStreamResponse, None, None]:
        full_text = "You can call me Miku Miku o~e~o~"

        for i in range(0, len(full_text)):
            response = TextGenerationStreamResponse(
                token = Token(id=i, text=full_text[i], logprob=0.0, special=False),
            )
            response.generated_text = full_text[i]
            response.details = StreamDetails(finish_reason='stop_sequence', generated_tokens=1)

            yield response

    def text_generation(self: InferenceClient, prompt: str, *,
        stream: Literal[False] = ...,
        model: Optional[str] = None,
        **kwargs: Any
    ) -> Union[TextGenerationResponse, Generator[TextGenerationStreamResponse, None, None]]:
        # check if key is valid
        if not re.match(r'Bearer\shf\-[a-zA-Z0-9]{16,}', self.headers['authorization']):
            raise BadRequestError('Invalid API key')
        
        if model is None:
            raise BadRequestError('Invalid model')
        
        if stream:
            return MockHuggingfaceChatClass.generate_create_stream(model)
        return MockHuggingfaceChatClass.generate_create_sync(model)

