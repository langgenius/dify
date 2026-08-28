"""Live LLM connectivity check for the Dify Builder agent.

Resolves the chosen model (or the tenant default) and does one real, cheap
completion — so operators can confirm the AI wiring works on a deployed stack
before any cognition exists.
"""

from typing import Any

from services.dify_builder.agent.llm import invoke_text
from services.dify_builder.agent.model_resolver import (
    normalize_completion_params,
    resolve_model_instance,
    resolved_model_names,
)


def ping_model(tenant_id: str, model_config: dict[str, Any] | None) -> dict[str, Any]:
    instance = resolve_model_instance(tenant_id, model_config)
    params, stop = normalize_completion_params((model_config or {}).get("completion_params", {}))
    reply = invoke_text(
        instance,
        system="You are a health check.",
        user="Reply with the single word OK.",
        model_parameters=params,
        stop=stop,
    )
    return {"ok": True, "model": resolved_model_names(tenant_id, model_config), "reply": reply}
