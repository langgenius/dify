import json
from decimal import Decimal

import httpx
from graphon.model_runtime.entities.llm_entities import (
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
)
from pydantic import BaseModel

_ZERO_PRICE = Decimal(0)


def make_usage(
    prompt_tokens: int = 3,
    completion_tokens: int = 5,
    *,
    prompt_unit_price: Decimal = _ZERO_PRICE,
    prompt_price_unit: Decimal = _ZERO_PRICE,
    prompt_price: Decimal = _ZERO_PRICE,
    completion_unit_price: Decimal = _ZERO_PRICE,
    completion_price_unit: Decimal = _ZERO_PRICE,
    completion_price: Decimal = _ZERO_PRICE,
    total_price: Decimal = _ZERO_PRICE,
    currency: str = "USD",
    latency: float = 0.1,
    time_to_first_token: float | None = None,
    time_to_generate: float | None = None,
) -> LLMUsage:
    return LLMUsage(
        prompt_tokens=prompt_tokens,
        prompt_unit_price=prompt_unit_price,
        prompt_price_unit=prompt_price_unit,
        prompt_price=prompt_price,
        completion_tokens=completion_tokens,
        completion_unit_price=completion_unit_price,
        completion_price_unit=completion_price_unit,
        completion_price=completion_price,
        total_tokens=prompt_tokens + completion_tokens,
        total_price=total_price,
        currency=currency,
        latency=latency,
        time_to_first_token=time_to_first_token,
        time_to_generate=time_to_generate,
    )


def single_text_chunk(
    text: str,
    *,
    prompt_tokens: int = 3,
    completion_tokens: int = 5,
) -> list[LLMResultChunk]:
    return [
        LLMResultChunk(
            model="demo-model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=text, tool_calls=[]),
                usage=make_usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
            ),
        )
    ]


def wrap_plugin_daemon_stream_item(item: object) -> str:
    if isinstance(item, BaseModel):
        data = item.model_dump(mode="json")
    else:
        data = item
    return f"data: {json.dumps({'code': 0, 'message': '', 'data': data})}\n\n"


def build_stream_response(*items: object, status_code: int = 200) -> httpx.Response:
    body = "".join(wrap_plugin_daemon_stream_item(item) for item in items)
    return httpx.Response(
        status_code=status_code,
        headers={"content-type": "text/event-stream"},
        content=body.encode("utf-8"),
    )


def build_error_response(error_type: str, message: str, *, status_code: int) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        headers={"content-type": "application/json"},
        content=json.dumps({"error_type": error_type, "message": message}).encode("utf-8"),
    )


def build_stream_error(error_type: str, message: str, *, code: int = -500) -> httpx.Response:
    return httpx.Response(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=(
            f"data: {json.dumps({'code': code, 'message': json.dumps({'error_type': error_type, 'message': message}), 'data': None})}\n\n"
        ).encode("utf-8"),
    )
