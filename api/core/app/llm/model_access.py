from __future__ import annotations

import json
import logging
from copy import deepcopy
from typing import Any

from sqlalchemy import select

from core.app.entities.app_invoke_entities import DifyRunContext, ModelConfigWithCredentialsEntity
from core.db.session_factory import session_factory
from core.errors.error import ProviderTokenNotInitError
from core.helper import encrypter
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.provider_manager import ProviderManager
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.nodes.llm.entities import ModelConfig
from graphon.nodes.llm.exc import LLMModeRequiredError, ModelNotExistError
from graphon.nodes.llm.protocols import CredentialsProvider
from models.provider import ProviderCredential

logger = logging.getLogger(__name__)


class DifyCredentialsProvider:
    """Resolves and returns LLM credentials for a given provider and model.

    Fetched credentials are stored in :attr:`credentials_cache` and reused for
    subsequent ``fetch`` calls for the same ``(provider_name, model_name)``.
    Because of that cache, a single instance can return stale credentials after
    the tenant or provider configuration changes (e.g. API key rotation).

    Do **not** keep one instance for the lifetime of a process or across
    unrelated invocations. Create a new provider per request, workflow run, or
    other bounded scope where up-to-date credentials matter.
    """

    tenant_id: str
    provider_manager: ProviderManager
    credentials_cache: dict[tuple[str, str], dict[str, Any]]

    def __init__(
        self,
        *,
        run_context: DifyRunContext,
        provider_manager: ProviderManager | None = None,
        credential_overrides: dict[str, str] | None = None,
    ) -> None:
        self.tenant_id = run_context.tenant_id
        self.credential_overrides = credential_overrides or {}
        if provider_manager is None:
            provider_manager = create_plugin_provider_manager(
                tenant_id=run_context.tenant_id,
                user_id=run_context.user_id,
            )
        self.provider_manager = provider_manager
        self.credentials_cache = {}

    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        # Check for per-run credential override for this provider
        override_credential_id = self.credential_overrides.get(provider_name)
        if override_credential_id:
            cache_key_override = (f"__override__{provider_name}", override_credential_id)
            if cache_key_override in self.credentials_cache:
                return deepcopy(self.credentials_cache[cache_key_override])

            credentials = self._fetch_by_credential_id(
                credential_id=override_credential_id,
                provider_name=provider_name,
            )
            self.credentials_cache[cache_key_override] = deepcopy(credentials)
            return credentials

        # Default resolution logic
        if (provider_name, model_name) in self.credentials_cache:
            return deepcopy(self.credentials_cache[(provider_name, model_name)])

        provider_configurations = self.provider_manager.get_configurations(self.tenant_id)
        provider_configuration = provider_configurations.get(provider_name)
        if not provider_configuration:
            raise ValueError(f"Provider {provider_name} does not exist.")

        provider_model = provider_configuration.get_provider_model(model_type=ModelType.LLM, model=model_name)
        if provider_model is None:
            raise ModelNotExistError(f"Model {model_name} not exist.")
        provider_model.raise_for_status()

        credentials = provider_configuration.get_current_credentials(model_type=ModelType.LLM, model=model_name)
        if credentials is None:
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")

        self.credentials_cache[(provider_name, model_name)] = deepcopy(credentials)
        return credentials

    def _fetch_by_credential_id(
        self,
        credential_id: str,
        provider_name: str,
    ) -> dict[str, Any]:
        """Resolve and decrypt credentials from a specific ProviderCredential record.

        Security: The credential must belong to the same tenant as the current run.
        """
        with session_factory.create_session() as session:
            stmt = select(ProviderCredential).where(
                ProviderCredential.id == credential_id,
                ProviderCredential.tenant_id == self.tenant_id,
            )
            credential_record = session.scalar(stmt)

        if credential_record is None:
            raise ProviderTokenNotInitError(
                f"Credential '{credential_id}' not found or does not belong to this workspace."
            )

        if credential_record.provider_name != provider_name:
            raise ValueError(
                f"Credential '{credential_id}' belongs to provider '{credential_record.provider_name}', "
                f"but was requested for provider '{provider_name}'."
            )

        # Decrypt the encrypted_config JSON blob
        try:
            credentials: dict[str, Any] = json.loads(credential_record.encrypted_config)
        except (json.JSONDecodeError, TypeError) as e:
            raise ProviderTokenNotInitError(
                f"Failed to parse credentials for credential '{credential_id}': {e}"
            )

        # Decrypt secret fields using tenant RSA key
        for key, value in credentials.items():
            if isinstance(value, str) and value:
                try:
                    credentials[key] = encrypter.decrypt_token(tenant_id=self.tenant_id, token=value)
                except Exception:
                    # Not an encrypted value or not valid base64, keep as-is
                    pass

        return credentials


class DifyModelFactory:
    tenant_id: str
    model_manager: ModelManager

    def __init__(
        self,
        *,
        run_context: DifyRunContext,
        model_manager: ModelManager | None = None,
    ) -> None:
        self.tenant_id = run_context.tenant_id
        if model_manager is None:
            model_manager = ModelManager(
                provider_manager=create_plugin_provider_manager(
                    tenant_id=run_context.tenant_id,
                    user_id=run_context.user_id,
                ),
                enable_credentials_cache=True,
            )
        self.model_manager = model_manager

    def init_model_instance(self, provider_name: str, model_name: str) -> ModelInstance:
        return self.model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=provider_name,
            model_type=ModelType.LLM,
            model=model_name,
        )


def build_dify_model_access(
    run_context: DifyRunContext,
    *,
    credential_overrides: dict[str, str] | None = None,
) -> tuple[CredentialsProvider, DifyModelFactory]:
    """Create LLM access adapters that share the same tenant-bound manager graph."""
    provider_manager = create_plugin_provider_manager(
        tenant_id=run_context.tenant_id,
        user_id=run_context.user_id,
    )
    model_manager = ModelManager(provider_manager=provider_manager, enable_credentials_cache=True)

    return (
        DifyCredentialsProvider(
            run_context=run_context,
            provider_manager=provider_manager,
            credential_overrides=credential_overrides,
        ),
        DifyModelFactory(run_context=run_context, model_manager=model_manager),
    )


def _normalize_completion_params(completion_params: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """
    Split node-level completion params into provider parameters and stop sequences.

    Workflow LLM-compatible nodes still consume runtime invocation settings from
    ``ModelInstance.parameters`` and ``ModelInstance.stop``. Keep the
    ``ModelInstance`` view and the returned config entity aligned here so callers
    do not need to duplicate normalization logic.
    """
    normalized_parameters = dict(completion_params)
    stop = normalized_parameters.pop("stop", [])
    if not isinstance(stop, list) or not all(isinstance(item, str) for item in stop):
        stop = []

    return normalized_parameters, stop


def fetch_model_config(
    *,
    node_data_model: ModelConfig,
    credentials_provider: CredentialsProvider,
    model_factory: DifyModelFactory,
) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
    if not node_data_model.mode:
        raise LLMModeRequiredError("LLM mode is required.")

    credentials = credentials_provider.fetch(node_data_model.provider, node_data_model.name)
    model_instance = model_factory.init_model_instance(node_data_model.provider, node_data_model.name)
    provider_model_bundle = model_instance.provider_model_bundle

    provider_model = provider_model_bundle.configuration.get_provider_model(
        model=node_data_model.name,
        model_type=ModelType.LLM,
    )
    if provider_model is None:
        raise ModelNotExistError(f"Model {node_data_model.name} does not exist.")
    provider_model.raise_for_status()

    model_schema = model_instance.model_type_instance.get_model_schema(node_data_model.name, credentials)
    if model_schema is None:
        raise ModelNotExistError(f"Model {node_data_model.name} schema does not exist.")

    parameters, stop = _normalize_completion_params(node_data_model.completion_params)
    model_instance.provider = node_data_model.provider
    model_instance.model_name = node_data_model.name
    model_instance.credentials = credentials
    model_instance.parameters = parameters
    model_instance.stop = tuple(stop)

    return model_instance, ModelConfigWithCredentialsEntity(
        provider=node_data_model.provider,
        model=node_data_model.name,
        model_schema=model_schema,
        mode=node_data_model.mode,
        credentials=credentials,
        parameters=parameters,
        stop=stop,
        provider_model_bundle=provider_model_bundle,
    )
