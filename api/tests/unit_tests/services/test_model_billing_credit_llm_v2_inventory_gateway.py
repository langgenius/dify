"""Actual credit-LLM-v2 saved-source / prospective readiness with real SQLite target ownership.

Only external metadata ports use bounded in-memory terminals. All schemas are
the frozen real SDK→Go→Core DTOs; no network, model, billing or funding occurs.
"""

from __future__ import annotations

import json
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field, replace
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.model_billing_migration_protocol import canonical_hash
from core.model_invocation_routing import ModelRouteUnavailable, ModelRouteUnmapped, RoutedModelCredentials
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from models.account import Tenant
from models.provider import ProviderCredential
from models.tokener import TenantTokenerIntegration
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services import model_billing_migration_inventory_gateway as module
from services.entities.model_billing_mapping import SelectedSourceVariant
from services.model_billing_dependency_provenance import ModelDependencySelectionSnapshot
from services.model_billing_mapping_service import restore_variant_source_contract, source_parameter_marker
from services.model_billing_migration_inventory import RequiredSavedCreditModel, SavedDependencySourceEvidence
from services.model_billing_openai_credit_llm_adapter import _REVIEWED_CONTRACTS as V1_CONTRACTS
from services.model_billing_openai_credit_llm_v2_adapter import OpenAICreditLLMSourceV2Contract
from services.model_billing_source_variants import selection_payload
from tests.unit_tests.services.model_billing_credit_llm_v2_fixtures import (
    PROFILES_BY_ID,
    REVISION,
    SELECTOR_CASES,
    SOURCE_PROVIDER,
    ProtocolSelector,
    credit_llm_v2_catalog,
    credit_llm_v2_credentials,
    credit_llm_v2_records,
    credit_llm_v2_registry,
    credit_llm_v2_runtime,
    profile_digest,
)
from tests.unit_tests.services.test_model_billing_migration_inventory_gateway import (
    Metadata,
    Selections,
    setup_gateway,
)

_TARGET_UID = "langgenius/tokener:9.9.9@" + "c" * 64  # Synthetic test installation, not a release.
_OPERATIONS = ("model/schema", "llm/invoke", "llm/num_tokens")


@dataclass(frozen=True)
class _SourceCall:
    uid: str | None
    plugin: str
    provider: str
    kind: str
    model: str
    credentials: dict[str, object]


@dataclass(frozen=True)
class _TargetCall:
    profile_id: str
    operations: tuple[str, ...]
    marker: dict[str, object]


@dataclass
class _Trace:
    source_calls: list[_SourceCall] = field(default_factory=list)
    target_calls: list[_TargetCall] = field(default_factory=list)
    source_overrides: dict[str, AIModelEntity | None] = field(default_factory=dict)
    target_overrides: dict[str, AIModelEntity | None] = field(default_factory=dict)
    operations: tuple[str, ...] = _OPERATIONS


@dataclass
class _Rig:
    gateway: module.SavedDependencyMigrationEvidenceGateway
    metadata: Metadata
    selections: Selections
    trace: _Trace
    profile_id: str
    selector: ProtocolSelector
    fingerprint: str
    system_credentials: dict[str, object]

    def collect(self, *, selected: bool = True) -> SavedDependencySourceEvidence:
        profile = PROFILES_BY_ID[self.profile_id]
        required = (
            (
                RequiredSavedCreditModel(
                    SOURCE_PROVIDER,
                    ModelType.LLM.value,
                    profile["source_model"],
                    ("paid",),
                ),
            )
            if selected
            else ()
        )
        return self.gateway.sources("tenant", REVISION, required, inventory_policy="saved_system_dependencies_v2")


def _inventory(evidence: SavedDependencySourceEvidence) -> dict[str, object]:
    return {
        "models": list(evidence.models),
        "source_ownership": dict(evidence.source_ownership),
        "unavailable_sources": list(evidence.unavailable_sources),
        "source_capability_policy_digest": evidence.source_policy_digest,
        "prospective_variants": list(evidence.prospective_variants),
        "source_variant_registry_digest": evidence.source_variant_registry_digest,
    }


def _financial_replay(evidence: SavedDependencySourceEvidence) -> dict[str, object]:
    """Hash the entire financial inventory, then replay every frozen selector."""
    inventory = _inventory(evidence)
    original_hash = canonical_hash(inventory)
    replayed = cast(dict[str, object], json.loads(json.dumps(inventory)))
    registry = credit_llm_v2_registry()
    for key in ("models", "prospective_variants"):
        for row in cast(list[dict[str, object]], replayed[key]):
            provider, model = cast(str, row["provider"]), cast(str, row["model"])
            kind = ModelType(row["model_type"])
            selected = registry.restore_selection((provider, kind, model), row["source_variant"])
            assert isinstance(selected, SelectedSourceVariant)
            row["source_variant"] = selection_payload(selected).model_dump(mode="json")
            if key == "models":
                row["source_parameter_contract"] = source_parameter_marker(
                    restore_variant_source_contract(selected),
                    source_provider=provider,
                    source_model=model,
                    model_type=kind,
                    target_model=selected.target.model,
                )
    assert canonical_hash(replayed) == original_hash
    assert canonical_hash(json.loads(json.dumps(replayed))) == original_hash
    return replayed


def _setup(
    monkeypatch: pytest.MonkeyPatch,
    factory: sessionmaker[Session],
    profile_id: str,
    selector: ProtocolSelector,
) -> _Rig:
    gateway, metadata, _, selections = setup_gateway(monkeypatch, factory)
    profile = PROFILES_BY_ID[profile_id]
    provider = SOURCE_PROVIDER
    plugin, provider_name = provider.rsplit("/", 1)
    uid = profile["source_plugin_uid"]
    catalog = credit_llm_v2_catalog(profile_id)
    binding = metadata.bindings[0]
    binding.provider = provider
    binding.plugin_id = plugin
    binding.plugin_unique_identifier = uid
    binding.version = uid.split(":", 1)[1].split("@", 1)[0]
    declaration = metadata.catalogs[0]
    declaration.provider = provider
    declaration.plugin_id = plugin
    declaration.plugin_unique_identifier = uid
    declaration.declaration.provider = provider
    declaration.declaration.models = [catalog]
    declaration.declaration.supported_model_types = [catalog.model_type]
    selections.value = replace(
        selections.value,
        providers=(
            replace(
                selections.value.providers[0],
                provider=provider,
                source_plugin_unique_identifier=uid,
                custom_available=True,
            ),
        ),
    )
    credentials = credit_llm_v2_credentials(profile_id, selector)
    key = "openai_api_key"
    credentials[key] = "platform-test-boundary"
    hosting = module.ext_hosting_provider.hosting_configuration.provider_map["langgenius/openai/openai"]
    monkeypatch.setitem(
        module.ext_hosting_provider.hosting_configuration.provider_map,
        provider,
        hosting.model_copy(update={"credentials": deepcopy(credentials)}),
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps(credit_llm_v2_records()))
    trace = _Trace()

    # Exercise the actual repository's tenant/provider/credential join, not a
    # fake managed_target_binding. The unrelated BYOK ciphertext is never read.
    with factory.begin() as session:
        tenant = Tenant(name="offline-credit-llm-v2")
        tenant.id = "tenant"
        session.add(tenant)
        session.flush()
        managed = ProviderCredential(
            tenant_id="tenant",
            provider_name="langgenius/tokener/tokener",
            credential_name="managed-test",
            encrypted_config="ENCRYPTED_MANAGED_TEST_ONLY",
        )
        byok = ProviderCredential(
            tenant_id="tenant",
            provider_name=provider,
            credential_name="must-not-use-byok",
            encrypted_config="BYOK_MUST_NOT_READ_OR_DECRYPT",
        )
        session.add_all([managed, byok])
        session.flush()
        managed_id = managed.id
        session.add(
            TenantTokenerIntegration(
                tenant_id="tenant", provider_credential_id=managed_id, plugin_unique_identifier=_TARGET_UID
            )
        )
    target = ModelBillingDependencyRepository(session_factory=factory).managed_target_binding("tenant")
    assert target is not None
    assert target.credential_id == managed_id
    monkeypatch.setattr(
        module,
        "migration_routing_state",
        lambda tenant: {
            "provisioned_binding": {
                "tenant_id": tenant,
                "provider_name": "langgenius/tokener/tokener",
                "provider_credential_id": managed_id,
                "credential_fingerprint": target.credential_fingerprint,
            }
        },
    )

    def metadata_schema(
        tenant_id: str,
        user_id: str | None,
        requested_plugin: str,
        requested_provider: str,
        kind: str,
        model: str,
        supplied: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity | None:
        assert tenant_id == "tenant"
        assert user_id is None
        if isinstance(supplied, RoutedModelCredentials):
            assert dict(supplied) == {}
            plan = supplied.plan
            contract = plan.source_parameter_contract
            assert type(contract) is OpenAICreditLLMSourceV2Contract
            assert plan.plugin_unique_identifier == _TARGET_UID
            assert plan.credential_id == managed_id
            expected_profile = PROFILES_BY_ID[contract.profile_id]
            assert (requested_plugin + "/" + requested_provider, kind, model) == (
                SOURCE_PROVIDER,
                ModelType.LLM.value,
                expected_profile["source_model"],
            )
            assert plugin_unique_identifier is None
            assert plan.operations == tuple(expected_profile["operations"])
            marker = source_parameter_marker(
                contract,
                source_provider=SOURCE_PROVIDER,
                source_model=expected_profile["source_model"],
                model_type=ModelType.LLM,
                target_model=expected_profile["target_model"],
            )
            assert marker["profile_id"] == contract.profile_id
            assert marker["rules_digest"] == profile_digest(expected_profile)
            trace.target_calls.append(_TargetCall(contract.profile_id, plan.operations, marker))
            return trace.target_overrides.get(
                contract.profile_id,
                credit_llm_v2_runtime(contract.profile_id).model_copy(
                    update={"model": expected_profile["target_model"]}
                ),
            )
        assert (requested_plugin, requested_provider, kind, model) == (
            plugin,
            provider_name,
            catalog.model_type.value,
            catalog.model,
        )
        assert plugin_unique_identifier == uid
        assert supplied == credentials
        assert supplied.get(key) == "platform-test-boundary"
        assert "BYOK" not in repr(supplied)
        trace.source_calls.append(
            _SourceCall(plugin_unique_identifier, requested_plugin, requested_provider, kind, model, deepcopy(supplied))
        )
        return trace.source_overrides.get(
            profile_id, AIModelEntity.model_validate(deepcopy(profile["source_daemon_schema"]))
        )

    def capabilities(*_args: object, **_kwargs: object) -> module.RedirectCapabilities:
        return module.RedirectCapabilities(protocols=["model-redirect/v1"], operations=list(trace.operations))

    monkeypatch.setattr(metadata, "get_model_schema", metadata_schema)
    monkeypatch.setattr(metadata, "_request_with_plugin_daemon_response", capabilities)
    return _Rig(
        gateway, metadata, selections, trace, profile_id, selector, target.credential_fingerprint, deepcopy(credentials)
    )


def _sample(version: str, model: str, protocol: str, endpoint: str) -> str:
    return next(
        profile_id
        for profile_id, profile in PROFILES_BY_ID.items()
        if (profile["source_version"], profile["source_model"], profile["protocol"], profile["source_endpoint_class"])
        == (version, model, protocol, endpoint)
    )


_SAMPLES: tuple[tuple[str, ProtocolSelector], ...] = (
    (_sample("042", "gpt-4.1", "chat", "unset"), "absent"),
    (_sample("042", "gpt-5-2025-08-07", "responses", "official_root"), "responses"),
    (_sample("042", "gpt-5-mini-2025-08-07", "chat", "official_root"), "chat"),
    (_sample("110", "gpt-6-sol", "responses", "official_root"), "absent"),
    (_sample("110", "gpt-4o-mini", "chat", "unset"), "chat"),
)
_TARGET_SAMPLES = tuple(
    profile_id for profile_id, profile in PROFILES_BY_ID.items() if profile["source_model"] == "gpt-4.1"
) + (_SAMPLES[1][0], _SAMPLES[2][0])
_V1_BY_ID = {contract.profile_id: contract for contract in V1_CONTRACTS}


@pytest.mark.parametrize(("profile_id", "selector"), _SAMPLES)
def test_original_042_aliases_and_110_sources_require_fresh_uid_rpc_plus_all_192_target_profiles(
    profile_id: str,
    selector: ProtocolSelector,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id, selector)
    evidence = rig.collect()
    profile = PROFILES_BY_ID[profile_id]
    assert len(evidence.models) == 1
    assert len(evidence.prospective_variants) == 192
    assert len(rig.trace.source_calls) == 1
    source = rig.trace.source_calls[0]
    assert source.uid == profile["source_plugin_uid"]
    assert source.model == profile["source_model"]
    assert source.credentials == rig.system_credentials
    actual = evidence.models[0]
    assert actual["source_plugin_uid"] == profile["source_plugin_uid"]
    assert actual["source_runtime_schema_digest"] == profile["source_runtime_schema_digest"]
    selection = cast(dict[str, object], actual["source_variant"])
    assert selection["source_settings"] == {"protocol_selector": selector, **profile["source_settings"]}
    marker = cast(dict[str, object], actual["source_parameter_contract"])
    assert marker["profile_id"] == profile_id
    assert marker["source_model"] == profile["source_model"]
    assert rig.gateway.validate_target("tenant", REVISION, _financial_replay(evidence)) == rig.fingerprint
    expected = Counter(profile_id for profile_id, _ in SELECTOR_CASES)
    expected[profile_id] += 1
    assert Counter(call.profile_id for call in rig.trace.target_calls) == expected
    assert len(rig.trace.target_calls) == 193
    assert len(rig.trace.source_calls) == 1
    assert (
        module.ext_hosting_provider.hosting_configuration.provider_map[SOURCE_PROVIDER].credentials
        == rig.system_credentials
    )


def test_empty_free_candidate_still_requires_all_192_prospective_handshakes(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    profile_id, selector = _SAMPLES[0]
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id, selector)
    rig.selections.value = ModelDependencySelectionSnapshot((), ())
    rig.metadata.bindings.clear()
    rig.metadata.catalogs.clear()
    evidence = rig.collect(selected=False)
    assert evidence.models == ()
    assert evidence.source_ownership == {}
    assert rig.trace.source_calls == []
    assert len(evidence.prospective_variants) == 192
    assert rig.gateway.validate_target("tenant", REVISION, _financial_replay(evidence)) == rig.fingerprint
    assert Counter(call.profile_id for call in rig.trace.target_calls) == Counter(
        profile_id for profile_id, _ in SELECTOR_CASES
    )


@pytest.mark.parametrize(("profile_id", "selector"), [_SAMPLES[1], _SAMPLES[2]])
def test_the_two_reviewed_dated_aliases_also_accept_exact_logical_schema_labels(
    profile_id: str,
    selector: ProtocolSelector,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id, selector)
    rig.trace.target_overrides[profile_id] = credit_llm_v2_runtime(profile_id)
    assert rig.gateway.validate_target("tenant", REVISION, _financial_replay(rig.collect())) == rig.fingerprint


@pytest.mark.parametrize(("profile_id", "selector"), _SAMPLES)
@pytest.mark.parametrize("drift", ["uid", "catalog", "runtime", "runtime_type", "selector", "endpoint"])
def test_actual_source_fresh_binding_catalog_runtime_and_settings_must_match(
    profile_id: str,
    selector: ProtocolSelector,
    drift: str,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id, selector)
    if drift == "uid":
        rig.metadata.bindings[0].plugin_unique_identifier += "-changed"
    elif drift == "catalog":
        rig.metadata.catalogs[0].declaration.models = [
            credit_llm_v2_catalog(profile_id).model_copy(update={"model_properties": {}})
        ]
    elif drift in {"runtime", "runtime_type"}:
        rig.trace.source_overrides[profile_id] = credit_llm_v2_runtime(profile_id).model_copy(
            update={"model_type": ModelType.TEXT_EMBEDDING} if drift == "runtime_type" else {"model_properties": {}}
        )
    else:
        hosting = module.ext_hosting_provider.hosting_configuration.provider_map[SOURCE_PROVIDER]
        assert hosting.credentials is not None
        hosting.credentials["api_protocol" if drift == "selector" else "openai_api_base"] = "unreviewed"
    with pytest.raises(ModelRouteUnavailable):
        rig.collect()
    assert rig.trace.target_calls == []


@pytest.mark.parametrize("profile_id", _TARGET_SAMPLES)
@pytest.mark.parametrize("drift", ["missing", "catalog", "type", "unknown_model"])
def test_every_protocol_endpoint_source_version_and_alias_requires_full_target_schema(
    profile_id: str, drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, *_SAMPLES[0])
    evidence = rig.collect(selected=False)
    if drift == "missing":
        changed = None
    elif drift == "catalog":
        changed = credit_llm_v2_catalog(profile_id)
    elif drift == "type":
        changed = credit_llm_v2_runtime(profile_id).model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})
    else:
        changed = credit_llm_v2_runtime(profile_id).model_copy(update={"model": "unreviewed-model"})
    rig.trace.target_overrides[profile_id] = changed
    with pytest.raises(ModelRouteUnmapped):
        rig.gateway.validate_target("tenant", REVISION, _inventory(evidence))


@pytest.mark.parametrize(
    "drift", ["missing", "duplicate", "replaced", "registry", "runtime", "prospective_label", "old_v1_selection"]
)
def test_complete_prospective_set_cannot_be_shortened_replaced_or_reclassified(
    drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, *_SAMPLES[0])
    inventory = deepcopy(_inventory(rig.collect(selected=False)))
    rows = cast(list[dict[str, object]], inventory["prospective_variants"])
    if drift == "missing":
        rows.pop()
    elif drift == "duplicate":
        rows.append(deepcopy(rows[0]))
    elif drift == "replaced":
        rows[-1] = deepcopy(rows[0])
    elif drift == "registry":
        inventory["source_variant_registry_digest"] = "sha256:" + "0" * 64
    elif drift == "prospective_label":
        rows[0]["evidence"] = "actual_source"
    else:
        selection = cast(dict[str, object], rows[0]["source_variant"])
        if drift == "runtime":
            selection["source_runtime_schema_digest"] = "sha256:" + "0" * 64
        else:
            selection["variant_id"] = str(selection["variant_id"]).replace("openai-credit-v2-", "openai-credit-", 1)
    with pytest.raises(ModelRouteUnavailable):
        rig.gateway.validate_target("tenant", REVISION, inventory)
    assert rig.trace.target_calls == []


@pytest.mark.parametrize(("profile_id", "selector"), _SAMPLES)
@pytest.mark.parametrize("drift", ["old_marker", "old_owner", "old_rules", "uid", "runtime", "prospective_label"])
def test_actual_source_old_v1_owner_or_prospective_label_never_bypasses_v2_attestation(
    profile_id: str,
    selector: ProtocolSelector,
    drift: str,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id, selector)
    inventory = deepcopy(_inventory(rig.collect()))
    actual = cast(list[dict[str, object]], inventory["models"])[0]
    old_contract = _V1_BY_ID[profile_id.replace("openai-credit-v2-", "openai-credit-", 1)]
    if drift == "old_marker":
        actual["source_parameter_contract"] = source_parameter_marker(
            old_contract,
            source_provider=SOURCE_PROVIDER,
            source_model=old_contract.source_model,
            model_type=ModelType.LLM,
            target_model=old_contract.target_model,
        )
    elif drift == "old_owner":
        actual["source_parameter_contract"] = old_contract
    elif drift == "old_rules":
        cast(dict[str, object], actual["source_parameter_contract"])["rules_digest"] = old_contract.rules_digest
    elif drift == "uid":
        actual["source_plugin_uid"] = "unreviewed"
    elif drift == "runtime":
        actual["source_runtime_schema_digest"] = "sha256:" + "0" * 64
    else:
        actual["evidence"] = "reviewed_target_profile_only"
        actual.pop("source_plugin_uid")
        actual.pop("source_parameter_contract")
        actual.pop("source_runtime_schema_digest")
    with pytest.raises(ModelRouteUnavailable):
        rig.gateway.validate_target("tenant", REVISION, inventory)


@pytest.mark.parametrize("operation", _OPERATIONS)
def test_all_three_llm_operations_are_required_for_prospective_readiness(
    operation: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, *_SAMPLES[0])
    evidence = rig.collect(selected=False)
    rig.trace.operations = tuple(value for value in _OPERATIONS if value != operation)
    with pytest.raises(ModelRouteUnavailable):
        rig.gateway.validate_target("tenant", REVISION, _inventory(evidence))
