"""Local Dify 1.17.1 compatibility for credential-scoped remote model discovery.

The native SDK lacks a list-discovery RPC. Reuse the existing model-list entry
point and single-model schema contract without altering frontend or daemon ABI.
"""

from model_catalog import (
    CatalogAuthorizationError,
    CatalogConnectionError,
    CatalogRateLimitError,
    CatalogUnavailableError,
    fetch_catalog,
)


def uses_remote_catalog(provider: str) -> bool:
    return provider in {
        "amdgpucloud/amdgpucloud/amdgpucloud",
        "letian-kang/amdgpucloud/amdgpucloud",
    }


def _fetch(api_key: str, tenant_id: str, provider: str) -> list[dict]:
    from graphon.model_runtime.errors.invoke import (
        InvokeAuthorizationError,
        InvokeConnectionError,
        InvokeRateLimitError,
        InvokeServerUnavailableError,
    )

    try:
        return fetch_catalog(api_key, scope=f"{tenant_id}:{provider}")
    except CatalogAuthorizationError:
        raise InvokeAuthorizationError("AMDGPUCloud model catalog credentials are invalid") from None
    except CatalogConnectionError:
        raise InvokeConnectionError("AMDGPUCloud model discovery connection failed") from None
    except CatalogRateLimitError:
        raise InvokeRateLimitError("AMDGPUCloud model discovery was rate limited") from None
    except CatalogUnavailableError:
        raise InvokeServerUnavailableError("AMDGPUCloud model catalog is unavailable") from None


def resolve_provider_models(configuration, schema):
    from graphon.model_runtime.entities.model_entities import AIModelEntity

    # Deliberately request provider-level credentials, not an invented model ID.
    # This also executes Dify's existing credential-policy checks.
    from graphon.model_runtime.entities.model_entities import ModelType

    credentials = configuration.get_current_credentials(ModelType.LLM, "")
    resolved = schema.model_copy(deep=True)
    resolved.models = []
    if credentials:
        resolved.models = [
            AIModelEntity.model_validate(item)
            for item in _fetch(credentials.get("api_key", ""), configuration.tenant_id, schema.provider)
        ]
    # Only this request's schema is replaced. Never publish a user's catalog to
    # PluginService's cross-request declaration cache or plugin storage.
    configuration.provider = resolved
    configuration._cached_provider_schema = resolved
    return resolved


def resolve_model_schema(runtime, provider, model_type, model, credentials):
    from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
    from graphon.model_runtime.errors.invoke import InvokeBadRequestError

    if model_type != ModelType.LLM:
        raise InvokeBadRequestError("AMDGPUCloud supports chat models only")
    catalog = _fetch(credentials.get("api_key", ""), runtime.tenant_id, provider)
    for item in catalog:
        if item["model"] == model:
            return AIModelEntity.model_validate(item)
    raise InvokeBadRequestError("Model is not available in the current AMDGPUCloud catalog")