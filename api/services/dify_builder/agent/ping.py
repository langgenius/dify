"""Live LLM connectivity check for the Dify Builder agent.

Resolves the chosen model (or the tenant default) and does one real, cheap
completion — so operators can confirm the AI wiring works on a deployed stack
before any cognition exists.
"""

from typing import Any

from services.dify_builder.agent.llm import invoke_text
from services.dify_builder.agent.model_resolver import (
    normalize_completion_params,
)


def ping_model(tenant_id: str, model_config: dict[str, Any] | None, *, account_id: str | None = None) -> dict[str, Any]:
    from extensions.application_services.dify_builder_cognition_policy import guarded_cognition_model

    instance = guarded_cognition_model(tenant_id, model_config, account_id=account_id, app_id=None)
    params, stop = normalize_completion_params((model_config or {}).get("completion_params", {}))
    reply = invoke_text(
        instance,
        system="You are a health check.",
        user="Reply with the single word OK.",
        model_parameters=params,
        stop=stop,
    )
    return {"ok": True, "model": {"provider": instance.provider, "name": instance.model_name}, "reply": reply}
