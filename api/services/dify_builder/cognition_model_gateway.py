"""Native model adapter; credentials never enter policy records or responses."""

from collections.abc import Callable, Sequence
from typing import Any, Protocol

from core.dify_builder.models import Actor
from core.entities.model_entities import ModelWithProviderEntity
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError
from core.model_manager import ModelInstance, ModelManager
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from models.provider import ProviderType
from services.dify_builder.application.cognition_policy import CognitionModel, CognitionPolicyDeniedError


class ModelCredentialVisibility(Protocol):
    def model_credentials_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        provider_credential_ids: Sequence[str],
        model_credential_ids: Sequence[str],
    ) -> bool: ...


class NativeCognitionModels:
    def __init__(self, credentials: ModelCredentialVisibility):
        self._credentials = credentials

    def workspace_default(self, actor: Actor) -> CognitionModel | None:
        try:
            instance = ModelManager.for_tenant(actor.tenant_id, user_id=actor.account_id).get_default_model_instance(
                tenant_id=actor.tenant_id,
                model_type=ModelType.LLM,
            )
            model = self._active_model(instance)
            if model is None:
                return None
            return CognitionModel(
                "workspace_default",
                instance.provider,
                instance.model_name,
                str(model.model_properties.get(ModelPropertyKey.MODE, "chat")),
                {},
            )
        except (ValueError, ProviderTokenNotInitError, ModelCurrentlyNotSupportError):
            return None

    @staticmethod
    def _active_model(instance: ModelInstance) -> AIModelEntity | ModelWithProviderEntity | None:
        """Keep configured custom-model schema uncertainty out of fallback.

        The native catalogue intentionally omits custom models whose schema RPC
        fails. Builder must distinguish that unknown state from local absence
        or disablement; ordinary Workflow catalogue semantics stay unchanged.
        """
        configuration = instance.provider_model_bundle.configuration
        setting = next(
            (
                setting
                for setting in configuration.model_settings
                if setting.model_type == ModelType.LLM and setting.model == instance.model_name
            ),
            None,
        )
        if setting is not None and not setting.enabled:
            return None
        custom = next(
            (
                model
                for model in configuration.custom_configuration.models
                if model.model_type == ModelType.LLM and model.model == instance.model_name
            ),
            None,
        )
        if configuration.using_provider_type == ProviderType.CUSTOM and custom is not None:
            if custom.unadded_to_model_list or (custom.available_model_credentials and not custom.credentials):
                return None
            credentials = custom.credentials
        elif configuration.using_provider_type == ProviderType.SYSTEM and (
            configuration._get_original_provider_configurate_methods() == [ConfigurateMethod.CUSTOMIZABLE_MODEL]
        ):
            system = configuration.system_configuration
            quota = next(
                (quota for quota in system.quota_configurations if quota.quota_type == system.current_quota_type), None
            )
            if not system.enabled or quota is None or not quota.is_valid:
                return None
            restricted = next(
                (
                    model
                    for model in quota.restrict_models
                    if model.model_type == ModelType.LLM and model.model == instance.model_name
                ),
                None,
            )
            if restricted is None:
                return None
            credentials = dict(system.credentials or {})
            if restricted.base_model_name:
                credentials["base_model_name"] = restricted.base_model_name
        else:
            return configuration.get_provider_model(
                model_type=ModelType.LLM, model=instance.model_name, only_active=True
            )
        try:
            schema = configuration.get_model_schema(
                model_type=ModelType.LLM,
                model=instance.model_name,
                credentials=credentials,
            )
        except Exception as exc:
            raise CognitionPolicyDeniedError("model_availability_unknown") from exc
        if schema is None or schema.model != instance.model_name or schema.model_type != ModelType.LLM:
            raise CognitionPolicyDeniedError("model_availability_unknown")
        return schema

    def _visible(self, actor: Actor, instance: ModelInstance) -> bool:
        configuration = instance.provider_model_bundle.configuration
        if configuration.using_provider_type == ProviderType.SYSTEM:
            return True
        custom = configuration.custom_configuration
        provider_ids: list[str] = []
        model_ids: list[str] = []
        selected = next(
            (m for m in custom.models if m.model_type == ModelType.LLM and m.model == instance.model_name), None
        )
        if selected is not None and selected.credentials:
            if selected.current_credential_id:
                model_ids.append(selected.current_credential_id)
            else:
                return False
        elif custom.provider is not None and custom.provider.credentials:
            if custom.provider.current_credential_id:
                provider_ids.append(custom.provider.current_credential_id)
            else:
                return False
        else:
            return False
        # Select one native LB candidate before dispatch. Once a request is
        # sent, do not let native round-robin replay an uncertain invocation.
        if instance.load_balancing_manager is not None:
            candidate = instance.load_balancing_manager.fetch_next()
            if candidate is None:
                return False
            if candidate.name != "__inherit__":
                provider_ids = []
                model_ids = []
                if candidate.credential_id is None:
                    return False
                if candidate.credential_source_type == "custom_model":
                    model_ids.append(candidate.credential_id)
                elif candidate.credential_source_type == "provider":
                    provider_ids.append(candidate.credential_id)
                else:
                    return False
            instance.credentials = candidate.credentials
            instance.load_balancing_manager = None
        return self._credentials.model_credentials_visible(
            workspace_id=actor.tenant_id,
            actor_id=actor.account_id,
            provider=instance.provider,
            provider_credential_ids=provider_ids,
            model_credential_ids=model_ids,
        )

    def resolve(self, actor: Actor, model: CognitionModel) -> ModelInstance:
        instance = ModelManager.for_tenant(actor.tenant_id, user_id=actor.account_id).get_model_instance(
            tenant_id=actor.tenant_id,
            provider=model.provider,
            model_type=ModelType.LLM,
            model=model.name,
        )
        active = self._active_model(instance)
        if active is None or not self._visible(actor, instance):
            raise CognitionPolicyDeniedError("model_unavailable")
        return instance

    def available(self, actor: Actor, model: CognitionModel) -> bool:
        try:
            self.resolve(actor, model)
            return True
        except CognitionPolicyDeniedError as error:
            if error.reason == "model_unavailable":
                return False
            raise
        except (ValueError, ProviderTokenNotInitError, ModelCurrentlyNotSupportError):
            return False


class PolicyModelInstance:
    """Re-resolve the actor/policy/native selection before every completion.

    The resolver runs once before dispatch. Provider exceptions propagate with
    no new model selection or replay, including unknown request outcomes.
    """

    def __init__(self, resolve: Callable[[], Any]):
        self._resolve = resolve
        self.provider = ""
        self.model_name = ""

    def get_model_schema(self):
        """Resolve current admission before delegating advisory public metadata."""
        return self._resolve().get_model_schema()

    def invoke_llm(self, **kwargs):
        instance = self._resolve()
        try:
            self.provider = instance.provider
            self.model_name = instance.model_name
        except AttributeError:
            pass
        try:
            return instance.invoke_llm(**kwargs)
        except CognitionPolicyDeniedError:
            raise
        except Exception as exc:
            raise CognitionPolicyDeniedError("model_invocation_failed") from exc
