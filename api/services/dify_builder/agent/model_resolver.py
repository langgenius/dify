"""Resolve the user's per-session model choice to a live ModelInstance.

The choice is Dify's model-selector shape (a ``model_config`` dict:
{provider, name, mode, completion_params}). Empty/None means "use the
tenant's configured default LLM". This module is the only place in the
Dify Builder services layer that touches the model runtime for resolution.
"""

from typing import Any

from pydantic import ValidationError

from core.app.app_config.entities import ModelConfig
from core.dify_builder.errors import BadRequestError, ModelUnavailableError
from core.model_manager import ModelInstance, ModelManager
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType


def normalize_completion_params(completion_params: dict[str, Any]) -> tuple[dict[str, Any], list[str] | None]:
    """Split ``stop`` out of completion_params (invoke_llm takes it separately)."""
    params = dict(completion_params or {})
    stop = params.pop("stop", None)
    if isinstance(stop, str):
        stop = [stop]
    elif stop is not None and not isinstance(stop, list):
        stop = list(stop)
    return params, stop


def resolve_model_instance(tenant_id: str, model_config: dict[str, Any] | None) -> ModelInstance:
    """A chosen model_config -> that model; empty/None -> the tenant default LLM."""
    manager = ModelManager.for_tenant(tenant_id)
    if model_config:
        mc = ModelConfig.model_validate(model_config)
        return manager.get_model_instance(
            tenant_id=tenant_id, provider=mc.provider, model_type=ModelType.LLM, model=mc.name
        )
    return manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.LLM)


def validate_model_config(tenant_id: str, model_config: dict[str, Any] | None) -> dict[str, Any]:
    """Resolve and freeze an active model before persisting a session or model change.

    Missing configuration uses the tenant default. Availability checks use the
    provider's existing model status rules and credentials, without invoking an LLM.
    Malformed input remains a bad request; unavailable configuration is recoverable.
    """
    try:
        config = ModelConfig.model_validate(model_config) if model_config else None
    except ValidationError as exc:
        raise BadRequestError("invalid model_config") from exc

    try:
        instance = resolve_model_instance(tenant_id, config.model_dump() if config else None)
        model = instance.provider_model_bundle.configuration.get_provider_model(
            model_type=ModelType.LLM, model=instance.model_name, only_active=True
        )
        if model is None:
            raise ModelUnavailableError("Builder model is unavailable")
    except ValueError as exc:
        raise ModelUnavailableError("Builder model is unavailable") from exc

    return {
        "provider": instance.provider,
        "name": instance.model_name,
        "mode": str(model.model_properties.get(ModelPropertyKey.MODE, "")),
        "completion_params": config.completion_params if config else {},
    }


def resolved_model_names(tenant_id: str, model_config: dict[str, Any] | None) -> dict[str, str]:
    """Provider+name for display: the explicit pick, or the tenant default names."""
    if model_config:
        return {"provider": model_config.get("provider", ""), "name": model_config.get("name", "")}
    provider, name = ModelManager.for_tenant(tenant_id).get_default_provider_model_name(
        tenant_id=tenant_id, model_type=ModelType.LLM
    )
    return {"provider": provider or "", "name": name or ""}
