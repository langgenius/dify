"""Synchronous OpenAI SDK client example.

Uses the official ``openai`` Python SDK pointed at the gateway base URL. Demonstrates:

    * Basic chat completion (R1)
    * Switching models per-call (R3)
    * Reading references from ``message.metadata`` (R6)

Run:
    pip install openai>=1.0
    GATEWAY_URL=http://localhost:8080 SDK_KEY=bsa_dev_... python sync_client.py
"""

from __future__ import annotations

import os

from openai import OpenAI


def main() -> None:
    client = OpenAI(
        base_url=f"{os.environ.get('GATEWAY_URL', 'http://localhost:8080')}/v1",
        api_key=os.environ["SDK_KEY"],
    )

    # ---- list permitted models ----
    models = client.models.list()
    print("Available models:")
    for m in models.data:
        print(f"  - {m.id}")

    # ---- basic chat ----
    resp = client.chat.completions.create(
        model="qwen3.6-35b",
        messages=[
            {"role": "system", "content": "You are a base-station maintenance engineer."},
            {"role": "user", "content": "ALM-002 怎麼處理?"},
        ],
        # Gateway-specific extension (carried via OpenAI SDK extra_body):
        extra_body={"conversation_id": None},
    )

    print("\nAnswer:")
    print(resp.choices[0].message.content)

    # ---- references (R6) ----
    # Surfaced under choices[0].message.metadata; extra='allow' on schemas
    # means model_dump() retains it. The OpenAI SDK keeps unknown fields in
    # ``model_extra``; access via ``choices[0].message.model_dump()``.
    msg_dict = resp.choices[0].message.model_dump()
    metadata = msg_dict.get("metadata") or {}
    references = metadata.get("references", [])
    print(f"\nReferences ({len(references)}):")
    for ref in references:
        print(f"  - [score={ref.get('score'):.2f}] {ref.get('content')[:80]}")


if __name__ == "__main__":
    main()
