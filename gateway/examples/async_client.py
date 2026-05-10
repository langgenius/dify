"""Asynchronous OpenAI SDK client example with streaming.

Demonstrates:

    * Async chat completion with ``stream=True`` (R4)
    * Reading the final-chunk metadata to retrieve references (R6)

Run:
    pip install openai>=1.0
    GATEWAY_URL=http://localhost:8080 SDK_KEY=bsa_dev_... python async_client.py
"""

from __future__ import annotations

import asyncio
import os

from openai import AsyncOpenAI


async def main() -> None:
    client = AsyncOpenAI(
        base_url=f"{os.environ.get('GATEWAY_URL', 'http://localhost:8080')}/v1",
        api_key=os.environ["SDK_KEY"],
    )

    print("Streaming response:\n")
    references: list[dict] = []
    conversation_id: str | None = None

    stream = await client.chat.completions.create(
        model="qwen3.6-35b",
        messages=[
            {"role": "user", "content": "說明 ALM-002 的處理流程，逐步思考"},
        ],
        stream=True,
    )

    async for chunk in stream:
        choice = chunk.choices[0]
        delta = choice.delta

        if delta.content:
            print(delta.content, end="", flush=True)

        # Final chunk includes metadata; extra='allow' makes it land on model_extra.
        delta_dict = delta.model_dump()
        meta = delta_dict.get("metadata")
        if meta:
            references = meta.get("references", []) or references
            conversation_id = meta.get("conversation_id") or conversation_id

    print("\n")

    if conversation_id:
        print(f"conversation_id: {conversation_id}")
    print(f"References ({len(references)}):")
    for r in references:
        score = r.get("score") or 0.0
        content = (r.get("content") or "")[:80]
        print(f"  - [score={score:.2f}] {content}")


if __name__ == "__main__":
    asyncio.run(main())
