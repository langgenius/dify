"""Dify App DSL builder.

Generates the YAML payload accepted by ``POST /console/api/apps/imports``
(``mode=yaml-content``). The DSL produced is intentionally minimal: a
``chat`` mode App with a single model + optional knowledge base attachments.

For PR#1 we use Dify's basic ``chat`` mode (not Chatflow / advanced-chat) to
keep the surface narrow. Chatflow support can be added in a later PR if
custom workflow nodes (variable assignment, branching) become a requirement.
"""

from __future__ import annotations

from typing import Any

import yaml


def build_chat_app_dsl(
    *,
    name: str,
    description: str,
    provider: str,
    model_name: str,
    completion_params: dict[str, Any] | None = None,
    knowledge_base_ids: list[str] | None = None,
    pre_prompt: str = "",
) -> str:
    """Render a Dify ``chat`` mode App into YAML.

    Args:
        name: Human-readable App name (visible in Dify UI).
        description: Free-text description.
        provider: Dify model provider id (e.g.
            ``langgenius/openai_api_compatible/openai_api_compatible``).
        model_name: Provider-internal model name (matches what was registered
            via the model provider plugin).
        completion_params: Per-request defaults (``temperature``, ``max_tokens``,
            etc.). Empty dict if omitted.
        knowledge_base_ids: Dify Dataset IDs to attach. Empty list if omitted.
        pre_prompt: System prompt baked into the App.

    Returns:
        UTF-8 YAML string suitable for ``yaml-content`` import.
    """
    datasets_block: list[dict[str, Any]] = [
        {"dataset": {"id": kb_id}} for kb_id in (knowledge_base_ids or [])
    ]

    payload: dict[str, Any] = {
        "app": {
            "description": description,
            "icon": "🤖",
            "icon_background": "#FFEAD5",
            "mode": "chat",
            "name": name,
        },
        "model_config": {
            "model": {
                "provider": provider,
                "name": model_name,
                "mode": "chat",
                "completion_params": dict(completion_params or {}),
            },
            "pre_prompt": pre_prompt,
            "user_input_form": [],
            "dataset_configs": {
                "retrieval_model": "multiple",
                "datasets": {"datasets": datasets_block},
            },
            # The following keys are not strictly required by every Dify version
            # but are emitted to keep the import deterministic across versions.
            "opening_statement": "",
            "suggested_questions": [],
            "speech_to_text": {"enabled": False},
            "text_to_speech": {"enabled": False, "voice": "", "language": ""},
            "more_like_this": {"enabled": False},
            "sensitive_word_avoidance": {"enabled": False, "type": "", "configs": []},
            "agent_mode": {"enabled": False, "tools": []},
        },
    }

    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
