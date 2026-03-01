#!/usr/bin/env python3

import json
import time
import uuid
from collections.abc import Iterator
from typing import Any

from flask import Flask, Response, jsonify, request

app = Flask(__name__)

# Mock models list
MODELS = [
    {
        "id": "gpt-3.5-turbo",
        "object": "model",
        "created": 1677649963,
        "owned_by": "openai",
    },
    {"id": "gpt-4", "object": "model", "created": 1687882411, "owned_by": "openai"},
    {
        "id": "text-embedding-ada-002",
        "object": "model",
        "created": 1671217299,
        "owned_by": "openai-internal",
    },
]


@app.route("/v1/models", methods=["GET"])
def list_models() -> Any:
    """List available models."""
    return jsonify({"object": "list", "data": MODELS})


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions() -> Any:
    """Handle chat completions."""
    data = request.json or {}
    model = data.get("model", "gpt-3.5-turbo")
    messages = data.get("messages", [])
    stream = data.get("stream", False)

    # Generate mock response
    response_content = "This is a mock response from the OpenAI server."
    if messages:
        last_message = messages[-1].get("content", "")
        response_content = f"Mock response to: {last_message[:100]}..."

    if stream:
        # Streaming response
        def generate() -> Iterator[str]:
            # Send initial chunk
            chunk = {
                "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant", "content": ""},
                        "finish_reason": None,
                    }
                ],
            }
            yield f"data: {json.dumps(chunk)}\n\n"

            # Send content in chunks
            words = response_content.split()
            for word in words:
                chunk = {
                    "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": word + " "},
                            "finish_reason": None,
                        }
                    ],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                time.sleep(0.05)  # Simulate streaming delay

            # Send final chunk
            chunk = {
                "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            yield "data: [DONE]\n\n"

        return Response(generate(), mimetype="text/event-stream")
    else:
        # Non-streaming response
        return jsonify(
            {
                "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": response_content},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": len(str(messages)),
                    "completion_tokens": len(response_content.split()),
                    "total_tokens": len(str(messages)) + len(response_content.split()),
                },
            }
        )


@app.route("/v1/completions", methods=["POST"])
def completions() -> Any:
    """Handle text completions."""
    data = request.json or {}
    model = data.get("model", "gpt-3.5-turbo-instruct")
    prompt = data.get("prompt", "")

    response_text = f"Mock completion for prompt: {prompt[:100]}..."

    return jsonify(
        {
            "id": f"cmpl-{uuid.uuid4().hex[:8]}",
            "object": "text_completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "text": response_text,
                    "index": 0,
                    "logprobs": None,
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(response_text.split()),
                "total_tokens": len(prompt.split()) + len(response_text.split()),
            },
        }
    )


@app.route("/v1/embeddings", methods=["POST"])
def embeddings() -> Any:
    """Handle embeddings requests."""
    data = request.json or {}
    model = data.get("model", "text-embedding-ada-002")
    input_text = data.get("input", "")

    # Generate mock embedding (1536 dimensions for ada-002)
    mock_embedding = [0.1] * 1536

    return jsonify(
        {
            "object": "list",
            "data": [{"object": "embedding", "embedding": mock_embedding, "index": 0}],
            "model": model,
            "usage": {
                "prompt_tokens": len(input_text.split()),
                "total_tokens": len(input_text.split()),
            },
        }
    )


@app.route("/v1/models/<model_id>", methods=["GET"])
def get_model(model_id: str) -> tuple[Any, int] | Any:
    """Get specific model details."""
    for model in MODELS:
        if model["id"] == model_id:
            return jsonify(model)

    return jsonify({"error": "Model not found"}), 404


@app.route("/health", methods=["GET"])
def health() -> Any:
    """Health check endpoint."""
    return jsonify({"status": "healthy"})


if __name__ == "__main__":
    print("🚀 Starting Mock OpenAI Server on http://localhost:5004")
    print("Available endpoints:")
    print("  - GET  /v1/models")
    print("  - POST /v1/chat/completions")
    print("  - POST /v1/completions")
    print("  - POST /v1/embeddings")
    print("  - GET  /v1/models/<model_id>")
    print("  - GET  /health")
    app.run(host="0.0.0.0", port=5004, debug=True)
