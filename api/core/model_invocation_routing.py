"""Trusted, tenant-scoped routing for migrated hosted model invocations.

App identities remain logical identities. Only SYSTEM shared-pool credentials
can produce a route; user credential dictionaries cannot request a redirect.
The frozen plan contains references, never secrets. The managed key is loaded
by its exact tenant/provider/id at the transport boundary, not the user's
currently selected Tokener credential.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from enum import StrEnum
from operator import itemgetter
from typing import TYPE_CHECKING, Any, Literal, TypeGuard, override
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from sqlalchemy import select
from werkzeug.exceptions import ServiceUnavailable

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit
from core.model_billing_migration_protocol import canonical_hash
from core.repositories.model_billing_migration_repository import get_routing_state
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from models.provider import ProviderCredential, ProviderType
from models.provider_ids import ModelProviderID
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus

if TYPE_CHECKING:
    from core.entities.provider_configuration import ProviderConfiguration
    from core.entities.provider_entities import SystemConfiguration


class ModelRouteUnavailable(ServiceUnavailable):
    error_code = "model_route_unavailable"
    description = "Managed model routing is temporarily unavailable."


class ModelMigrationProcessing(ModelRouteUnavailable):
    error_code = "migration_processing"
    description = "Model billing migration is processing. Please retry shortly."


class ModelRouteUnmapped(ModelRouteUnavailable):
    error_code = "model_route_unmapped"
    description = "The managed model route has not been configured."


class ModelInvocationReprepare(ModelRouteUnavailable):
    error_code = "model_invocation_reprepare"
    description = "Model routing changed while preparing this invocation. Please retry."


class SettlementOwner(StrEnum):
    CUSTOM = "custom"
    SHARED_CREDIT_POOL = "shared_credit_pool"
    PROVIDER_FREE = "provider_free"
    UNMETERED = "unmetered"


def settlement_owner(system: SystemConfiguration, provider_type: ProviderType) -> SettlementOwner:
    """Mirror the reservation policy without making a reservation to probe it."""
    if provider_type != ProviderType.SYSTEM:
        return SettlementOwner.CUSTOM
    quota = next((q for q in system.quota_configurations if q.quota_type == system.current_quota_type), None)
    if not quota or quota.quota_limit == -1:
        return SettlementOwner.UNMETERED
    if quota.quota_type in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}:
        if quota.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES}:
            return SettlementOwner.SHARED_CREDIT_POOL
        return SettlementOwner.UNMETERED
    return SettlementOwner.PROVIDER_FREE


def migration_routing_state(tenant_id: str) -> dict[str, Any] | None:
    # Do not use the legacy billing-source TTL cache for cutover admission.
    try:
        return get_routing_state(tenant_id)
    except Exception:
        # Never expose SQL/connection detail, or treat a failed lookup as a
        # legacy decision that could reopen admission after cutover.
        raise ModelRouteUnavailable from None


def has_compatibility_route(state: dict[str, Any] | None) -> bool:
    if not state:
        return False
    phase = state.get("blocked_from") if state.get("phase") == "blocked" else state.get("phase")
    return phase in {"claimed", "granting", "activating", "active"} or (
        phase == "cancelled" and state.get("claimed_at") is not None
    )


def compatibility_quota_type(
    provider: str, quotas: list[QuotaConfiguration], state: dict[str, Any]
) -> ProviderQuotaType:
    """Restore prepared ownership without consulting the now-closed legacy wallet."""
    ownership = state.get("source_ownership", {}).get(str(ModelProviderID(provider)))
    if not isinstance(ownership, dict):
        raise ModelRouteUnavailable
    try:
        selected = ProviderQuotaType(ownership["current_quota_type"])
        for quota in quotas:
            if quota.quota_type == ProviderQuotaType.FREE:
                continue
            unmetered = ownership["quotas"][quota.quota_type.value]["unmetered"]
            if not isinstance(unmetered, bool):
                raise ValueError("Invalid provenance")
            # These are availability metadata, not a newly issued legacy quota.
            # Only a proven original unlimited pool may retain the -1 marker.
            quota.quota_limit = -1 if unmetered else 0
            quota.quota_used = 0
            quota.is_valid = unmetered
        current = next(q for q in quotas if q.quota_type == selected)
    except (KeyError, TypeError, ValueError, StopIteration):
        raise ModelRouteUnavailable from None
    if selected != ProviderQuotaType.FREE or current.is_valid:
        return selected
    # Independent provider-free allowance still follows its normal exhaustion
    # behavior. It may fall through to the migrated shared pool afterwards.
    from core.provider_manager import ProviderManager

    return ProviderManager._choice_current_using_quota_type(quotas)


def migration_display_status(tenant_id: str) -> Literal["none", "preparing", "processing", "active"]:
    state = migration_routing_state(tenant_id)
    if not state:
        return "none"
    if state.get("phase") == "active" or (
        state.get("phase") == "cancelled" and state.get("claimed_at") and state.get("ever_activated")
    ):
        return "active"
    return "processing" if has_compatibility_route(state) else "preparing"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MappingSource(_StrictModel):
    provider_id: str
    model_type: ModelType
    model: str = Field(min_length=1)
    mode: str = Field(min_length=1)


class MappingTarget(_StrictModel):
    plugin_id: Literal["langgenius/tokener"]
    provider: Literal["tokener"]
    model_type: ModelType
    model: str = Field(min_length=1)
    catalog_revision: str = Field(min_length=1)
    minimum_plugin_version: str = Field(min_length=1)


class ParameterAdapter(_StrictModel):
    id: Literal["identity_v1"]
    revision: str = Field(min_length=1)
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class ModelMapping(_StrictModel):
    schema_version: Literal[1]
    mapping_revision: str = Field(min_length=1)
    source: MappingSource
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    target: MappingTarget
    parameter_adapter: ParameterAdapter
    operations: list[str] = Field(min_length=1)
    conformance_fixture_ids: list[str] = Field(min_length=1)


def model_mappings() -> dict[tuple[str, ModelType, str], ModelMapping]:
    try:
        records = TypeAdapter(list[ModelMapping]).validate_json(dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON)
        result = {}
        for record in records:
            key = (str(ModelProviderID(record.source.provider_id)), record.source.model_type, record.source.model)
            if key in result or record.target.model_type != record.source.model_type:
                raise ValueError("Duplicate source or incompatible model type")
            result[key] = record
        return result
    except Exception:
        # Validation errors can contain config values. Do not log their payload.
        raise ModelRouteUnmapped from None


@dataclass(frozen=True, slots=True)
class FrozenModelInvocation:
    tenant_id: str
    route_id: str
    logical_provider: str
    logical_model: str
    model_type: ModelType
    route_epoch: int
    mapping_revision: str
    credential_id: str
    expected_credential_fingerprint: str
    plugin_unique_identifier: str
    target_model: str
    operations: tuple[str, ...]
    settlement_backend: str = "tokener"

    @property
    def cache_identity(self) -> str:
        identity = [
            self.tenant_id,
            self.route_epoch,
            self.mapping_revision,
            self.credential_id,
            self.expected_credential_fingerprint,
            self.plugin_unique_identifier,
            self.target_model,
            self.model_type.value,
        ]
        return hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()


class RoutedModelCredentials(dict[str, Any]):  # noqa: FURB189 - graphon requires a real dict
    """In-process trusted capability, not a serializable credential protocol.

    An ordinary dict from a client cannot forge this type. Accidental generic
    serialization emits an empty credential object, never the source key.
    """

    plan: FrozenModelInvocation

    @override
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        if len(args) != 1 or kwargs or not isinstance(args[0], FrozenModelInvocation):
            raise TypeError("A trusted frozen model invocation is required")
        super().__init__()
        self.plan = args[0]

    def __bool__(self) -> bool:
        return True

    @override
    def copy(self) -> RoutedModelCredentials:
        return RoutedModelCredentials(self.plan)


@dataclass(frozen=True, slots=True)
class LegacyModelBinding:
    tenant_id: str
    logical_provider: str
    logical_model: str
    model_type: ModelType
    route_epoch: int


class LegacyModelCredentials(dict[str, Any]):  # noqa: FURB189 - runtime requires a dict
    """Server-created legacy provenance, retained until its reservation settles."""

    binding: LegacyModelBinding

    @override
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        if len(args) != 2 or kwargs or not isinstance(args[0], dict) or not isinstance(args[1], LegacyModelBinding):
            raise TypeError("Legacy credentials and a trusted model binding are required")
        super().__init__(args[0])
        self.binding = args[1]

    @override
    def copy(self) -> LegacyModelCredentials:
        return LegacyModelCredentials(dict(self), self.binding)


def bind_legacy_credentials(
    configuration: ProviderConfiguration, model_type: ModelType, model: str, values: dict[str, Any]
) -> dict[str, Any]:
    if (
        settlement_owner(configuration.system_configuration, configuration.using_provider_type)
        != SettlementOwner.SHARED_CREDIT_POOL
    ):
        return values
    state = migration_routing_state(configuration.tenant_id)
    if has_compatibility_route(state):
        # Cutover between the route check and reading the old key must not
        # silently construct a legacy invocation after admission has closed.
        raise ModelInvocationReprepare
    return LegacyModelCredentials(
        values,
        LegacyModelBinding(
            tenant_id=configuration.tenant_id,
            logical_provider=str(ModelProviderID(configuration.provider.provider)),
            logical_model=model,
            model_type=model_type,
            route_epoch=int(state.get("route_epoch", 0)) if state else 0,
        ),
    )


def validate_invocation_admission(
    credentials: dict[str, Any], *, tenant_id: str, provider: str, model_type: ModelType, model: str
) -> None:
    """Validate the prepared snapshot immediately before reserving/invoking.

    Do not replace credentials here: schema, tokens, dispatch, and settlement
    must use the same binding. Already reserved calls do not re-enter this check.
    """
    if isinstance(credentials, RoutedModelCredentials):
        binding = credentials.plan
    elif isinstance(credentials, LegacyModelCredentials):
        binding = credentials.binding
    else:
        return
    if (tenant_id, str(ModelProviderID(provider)), model_type, model) != (
        binding.tenant_id,
        binding.logical_provider,
        binding.model_type,
        binding.logical_model,
    ):
        raise ModelRouteUnavailable
    state = migration_routing_state(tenant_id)
    if isinstance(credentials, LegacyModelCredentials):
        if has_compatibility_route(state) or (int(state.get("route_epoch", 0)) if state else 0) != binding.route_epoch:
            raise ModelInvocationReprepare
    elif (
        state is None
        or state.get("phase") not in {"active", "cancelled"}
        or (state.get("phase") == "cancelled" and not state.get("ever_activated"))
        or int(state["route_epoch"]) != binding.route_epoch
        or state.get("model_mapping_version") != credentials.plan.mapping_revision
    ):
        raise ModelInvocationReprepare


def routed_credentials(
    configuration: ProviderConfiguration, model_type: ModelType, model: str
) -> RoutedModelCredentials | None:
    if (
        settlement_owner(configuration.system_configuration, configuration.using_provider_type)
        != SettlementOwner.SHARED_CREDIT_POOL
    ):
        return None
    state = migration_routing_state(configuration.tenant_id)
    if not has_compatibility_route(state):
        return None
    if (
        state is None
        or state.get("phase") not in {"active", "cancelled"}
        or (state.get("phase") == "cancelled" and not state.get("ever_activated"))
    ):
        raise ModelMigrationProcessing
    provider = str(ModelProviderID(configuration.provider.provider))
    mapping = model_mappings().get((provider, model_type, model))
    if mapping is None or configuration.system_configuration.current_quota_type not in mapping.pool_types:
        raise ModelRouteUnmapped
    if state.get("model_mapping_version") != mapping.mapping_revision:
        raise ModelRouteUnmapped
    with session_factory.create_session() as session:
        integration = session.scalar(
            select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == configuration.tenant_id)
        )
        if (
            not integration
            or integration.status != TenantTokenerIntegrationStatus.READY
            or not integration.provider_credential_id
            or not integration.plugin_unique_identifier
        ):
            raise ModelRouteUnavailable
        expected_credential_fingerprint = _pinned_credential_fingerprint(
            state,
            configuration.tenant_id,
            integration.provider_credential_id,
        )
        plan = FrozenModelInvocation(
            tenant_id=configuration.tenant_id,
            route_id=str(uuid4()),
            logical_provider=provider,
            logical_model=model,
            model_type=model_type,
            route_epoch=int(state["route_epoch"]),
            mapping_revision=mapping.mapping_revision,
            credential_id=integration.provider_credential_id,
            expected_credential_fingerprint=expected_credential_fingerprint,
            plugin_unique_identifier=integration.plugin_unique_identifier,
            target_model=mapping.target.model,
            operations=tuple(mapping.operations),
        )
    return RoutedModelCredentials(plan)


def _valid_credential_fingerprint(value: Any) -> TypeGuard[str]:
    return (
        isinstance(value, str)
        and value.startswith("sha256:")
        and len(value) == 71
        and all(char in "0123456789abcdef" for char in value[7:])
    )


def _credential_fingerprint(encrypted_config: str) -> str:
    return canonical_hash({"encrypted_config": encrypted_config})


def _pinned_credential_fingerprint(
    state: dict[str, Any], tenant_id: str, credential_id: str, *, allow_provisioned: bool = False
) -> str:
    pin = state.get("preparation")
    if not pin and allow_provisioned:
        pin = state.get("provisioned_binding")
    if not isinstance(pin, dict) or (
        pin.get("tenant_id"),
        pin.get("provider_name"),
        pin.get("provider_credential_id"),
    ) != (tenant_id, "langgenius/tokener/tokener", credential_id):
        raise ModelRouteUnavailable
    fingerprint = pin.get("credential_fingerprint")
    if not _valid_credential_fingerprint(fingerprint):
        raise ModelRouteUnavailable
    return fingerprint


def managed_credentials(plan: FrozenModelInvocation) -> dict[str, Any]:
    from core.entities import PluginCredentialType
    from core.helper import encrypter
    from core.helper.credential_utils import runtime_check_credential_policy_compliance

    provider = "langgenius/tokener/tokener"
    with session_factory.create_session() as session:
        credential = session.scalar(
            select(ProviderCredential).where(
                ProviderCredential.tenant_id == plan.tenant_id,
                ProviderCredential.provider_name == provider,
                ProviderCredential.id == plan.credential_id,
            )
        )
        if credential is None or not credential.encrypted_config:
            raise ModelRouteUnavailable
        encrypted = credential.encrypted_config
    if (
        not isinstance(encrypted, str)
        or not _valid_credential_fingerprint(plan.expected_credential_fingerprint)
        or not hmac.compare_digest(_credential_fingerprint(encrypted), plan.expected_credential_fingerprint)
    ):
        # Editing a managed row cannot change where a frozen SYSTEM invocation
        # is billed. Fail before decrypting or sending any key to the plugin.
        raise ModelRouteUnavailable
    runtime_check_credential_policy_compliance(
        credential_id=plan.credential_id, provider=provider, credential_type=PluginCredentialType.MODEL
    )
    try:
        values = json.loads(encrypted)
        if not isinstance(values, dict) or not isinstance(values.get("api_key"), str):
            raise ValueError("Missing managed key")
        values["api_key"] = encrypter.decrypt_token(tenant_id=plan.tenant_id, token=values["api_key"])
        return values
    except Exception:
        raise ModelRouteUnavailable from None


def redirect_payload(plan: FrozenModelInvocation, data: dict[str, Any]) -> dict[str, Any]:
    if (
        data.get("model") != plan.logical_model
        or data.get("model_type") != plan.model_type.value
        or data.get("provider") != ModelProviderID(plan.logical_provider).provider_name
    ):
        raise ModelRouteUnavailable
    return {
        "version": 1,
        "route_id": plan.route_id,
        "target": {
            "plugin_id": "langgenius/tokener",
            "provider": "tokener",
            "model_type": plan.model_type.value,
            "model": plan.target_model,
            "expected_unique_identifier": plan.plugin_unique_identifier,
            "credentials": managed_credentials(plan),
        },
    }


def embedding_dimensions_contract(schema: AIModelEntity) -> str:
    """Use actual parameter metadata; Graphon has no embedding-dimension property.

    A fixed-dimensional model without a dimensions rule needs an explicit
    conformance fixture in the registry; absence is not an invented dimension.
    """
    rule = next((r for r in schema.parameter_rules if r.name == "dimensions"), None)
    if rule is None:
        return "fixed_by_model_fixture"
    contract = {
        "kind": "parameter",
        "type": rule.type.value,
        "default": rule.default,
        "min": rule.min,
        "max": rule.max,
        "options": list(rule.options),
    }
    # Parameter schemas legitimately contain null/float values; the migration
    # manifest's strict money-safe canonical JSON does not. Carry a digest of
    # the actual dimension rule instead of those schema values in the manifest.
    return (
        "sha256:"
        + hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    )


def migration_inventory(tenant_id: str, mapping_version: str) -> dict[str, Any]:
    """Export a non-secret source inventory before preparing a target plugin."""
    from core.plugin.impl.model import PluginModelClient
    from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager

    registry = model_mappings()
    client = PluginModelClient()
    inventory = []
    source_ownership = {}
    configurations = create_plugin_provider_manager(tenant_id=tenant_id).get_configurations(tenant_id)
    for provider_name, configuration in configurations:
        system = configuration.system_configuration
        if not system.enabled:
            continue
        if system.current_quota_type is None:
            raise ModelRouteUnavailable
        source_ownership[str(ModelProviderID(provider_name))] = {
            "current_quota_type": system.current_quota_type.value,
            "quotas": {q.quota_type.value: {"unmetered": q.quota_limit == -1} for q in system.quota_configurations},
        }
        sources: set[tuple[ModelType, str]] = set()
        for quota in system.quota_configurations:
            if (
                quota.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
                or quota.quota_limit == -1
                or quota.quota_unit not in {QuotaUnit.TIMES, QuotaUnit.CREDITS}
            ):
                continue
            if quota.restrict_models:
                sources.update((r.model_type, r.model) for r in quota.restrict_models)
            else:
                sources.update((m.model_type, m.model) for m in configuration.provider.models)
        for model_type, model in sorted(sources, key=lambda pair: (pair[0].value, pair[1])):
            rule = registry.get((str(ModelProviderID(provider_name)), model_type, model))
            if rule is None or rule.mapping_revision != mapping_version:
                raise ModelRouteUnmapped
            source_schema = next(
                (m for m in configuration.provider.models if m.model_type == model_type and m.model == model), None
            )
            if source_schema is None:
                source_credentials = dict(system.credentials or {})
                for quota in system.quota_configurations:
                    for restricted in quota.restrict_models:
                        if (
                            restricted.model_type == model_type
                            and restricted.model == model
                            and restricted.base_model_name
                        ):
                            source_credentials["base_model_name"] = restricted.base_model_name
                source_id = ModelProviderID(provider_name)
                source_schema = client.get_model_schema(
                    tenant_id,
                    None,
                    source_id.plugin_id,
                    source_id.provider_name,
                    model_type.value,
                    model,
                    source_credentials,
                )
            if source_schema is None:
                raise ModelRouteUnmapped
            source_digest = (
                "sha256:"
                + hashlib.sha256(
                    json.dumps(
                        source_schema.model_dump(mode="json"),
                        sort_keys=True,
                        separators=(",", ":"),
                        ensure_ascii=False,
                    ).encode()
                ).hexdigest()
            )
            if source_digest != rule.source_schema_digest:
                raise ModelRouteUnmapped
            required_ops = {"model/schema"}
            if model_type == ModelType.LLM:
                required_ops |= {"llm/invoke", "llm/num_tokens"}
            elif model_type == ModelType.TEXT_EMBEDDING:
                required_ops |= {"text_embedding/invoke", "text_embedding/num_tokens"}
            else:
                required_ops.add(f"{model_type.value}/invoke")
            if not required_ops <= set(rule.operations):
                raise ModelRouteUnmapped
            item = {
                "provider": str(ModelProviderID(provider_name)),
                "model_type": model_type.value,
                "model": model,
                "mapping_revision": rule.mapping_revision,
                "source_schema_digest": rule.source_schema_digest,
                "target_model": rule.target.model,
                "source_mode": rule.source.mode,
            }
            if model_type == ModelType.TEXT_EMBEDDING:
                item["embedding_dimensions"] = embedding_dimensions_contract(source_schema)
            inventory.append(item)
    if not inventory:
        raise ModelRouteUnmapped
    inventory.sort(key=itemgetter("provider", "model_type", "model"))
    return {
        "inventory_hash": canonical_hash(inventory),
        "model_mapping_version": mapping_version,
        "model_count": len(inventory),
        "models": inventory,
        "source_ownership": source_ownership,
    }


def validate_migration_readiness(tenant_id: str, mapping_version: str) -> dict[str, Any]:
    """Check our installed adapters/registry; never invoke a billable model."""
    from packaging.version import Version

    from core.plugin.impl.model import PluginModelClient

    inventory = migration_inventory(tenant_id, mapping_version)
    registry = model_mappings()
    client = PluginModelClient()
    capabilities = client._request_with_plugin_daemon_response(
        "GET", f"plugin/{tenant_id}/dispatch/redirect/v1/capabilities", dict[str, Any]
    )
    if "model-redirect/v1" not in capabilities.get("protocols", []):
        raise ModelRouteUnavailable
    operations = set(capabilities.get("operations", []))
    state = migration_routing_state(tenant_id)
    if state is None:
        raise ModelRouteUnavailable
    with session_factory.create_session() as session:
        integration = session.scalar(
            select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant_id)
        )
        if not integration or not integration.provider_credential_id or not integration.plugin_unique_identifier:
            raise ModelRouteUnavailable
        credential_id = integration.provider_credential_id
        plugin_unique_identifier = integration.plugin_unique_identifier
        expected_credential_fingerprint = _pinned_credential_fingerprint(
            state,
            tenant_id,
            credential_id,
            allow_provisioned=True,
        )
        credential = session.scalar(
            select(ProviderCredential).where(
                ProviderCredential.tenant_id == tenant_id,
                ProviderCredential.provider_name == "langgenius/tokener/tokener",
                ProviderCredential.id == credential_id,
            )
        )
        if (
            credential is None
            or not isinstance(credential.encrypted_config, str)
            or not hmac.compare_digest(
                _credential_fingerprint(credential.encrypted_config), expected_credential_fingerprint
            )
        ):
            raise ModelRouteUnavailable
    actual_version = plugin_unique_identifier.split(":", 1)[-1].split("@", 1)[0]
    for source in inventory["models"]:
        model_type = ModelType(source["model_type"])
        rule = registry[(source["provider"], model_type, source["model"])]
        if not set(rule.operations) <= operations:
            raise ModelRouteUnavailable
        if Version(actual_version) < Version(rule.target.minimum_plugin_version):
            raise ModelRouteUnavailable
        plan = FrozenModelInvocation(
            tenant_id=tenant_id,
            route_id=str(uuid4()),
            logical_provider=source["provider"],
            logical_model=source["model"],
            model_type=model_type,
            route_epoch=0,
            mapping_revision=mapping_version,
            credential_id=credential_id,
            expected_credential_fingerprint=expected_credential_fingerprint,
            plugin_unique_identifier=plugin_unique_identifier,
            target_model=rule.target.model,
            operations=tuple(rule.operations),
        )
        target_schema = client.get_model_schema(
            tenant_id,
            None,
            ModelProviderID(source["provider"]).plugin_id,
            ModelProviderID(source["provider"]).provider_name,
            model_type.value,
            source["model"],
            RoutedModelCredentials(plan),
        )
        if target_schema is None or target_schema.model_type != model_type:
            raise ModelRouteUnmapped
        if (
            model_type == ModelType.LLM
            and target_schema.model_properties.get(ModelPropertyKey.MODE) != rule.source.mode
        ):
            raise ModelRouteUnmapped
        if model_type == ModelType.TEXT_EMBEDDING and source["embedding_dimensions"] != embedding_dimensions_contract(
            target_schema
        ):
            raise ModelRouteUnmapped
    return {
        **inventory,
        "daemon_protocol": "model-redirect/v1",
        "credential_fingerprint": expected_credential_fingerprint,
    }
