"""Actual saved-source / prospective readiness with real SQLite target ownership.

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
from core.plugin.entities.plugin import PluginInstallationSource
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from models.account import Tenant
from models.provider import ProviderCredential
from models.tokener import TenantTokenerIntegration
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services import model_billing_migration_inventory_gateway as module
from services.entities.model_billing_audio_mapping import SelectedAudioSourceVariant
from services.entities.model_billing_mapping import model_schema_digest
from services.entities.model_billing_xai_mapping import SelectedXAISourceVariant
from services.model_billing_dependency_provenance import ModelDependencySelectionSnapshot
from services.model_billing_mapping_service import restore_variant_source_contract, source_parameter_marker
from services.model_billing_migration_inventory import RequiredSavedCreditModel, SavedDependencySourceEvidence
from services.model_billing_source_variants import selection_payload
from tests.unit_tests.services.model_billing_audio_xai_fixtures import (
    PROFILES_BY_ID,
    REVISION,
    SELECTOR_CASES,
    Endpoint,
    audio_xai_catalog,
    audio_xai_credentials,
    audio_xai_model_type,
    audio_xai_provider,
    audio_xai_records,
    audio_xai_registry,
    profile_digest,
)
from tests.unit_tests.services.test_model_billing_migration_inventory_gateway import (
    Metadata,
    Selections,
    setup_gateway,
)

_PROFILE_IDS = tuple(PROFILES_BY_ID)
_FAMILY_IDS = tuple(
    next(profile_id for profile_id, profile in PROFILES_BY_ID.items() if profile["adapter_id"] == family)
    for family in ("openai_stt_source_v1", "openai_tts_source_v1", "xai_credit_llm_source_v1")
)
_TARGET_UID = "langgenius/tokener:9.9.9@" + "c" * 64  # Synthetic test installation, not a release.
_OPERATIONS = ("model/schema", "tts/invoke", "tts/model/voices", "speech2text/invoke", "llm/invoke", "llm/num_tokens")


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
    endpoint: Endpoint
    fingerprint: str
    system_credentials: dict[str, object]

    def collect(self, *, selected: bool = True) -> SavedDependencySourceEvidence:
        profile = PROFILES_BY_ID[self.profile_id]
        required = (
            (
                RequiredSavedCreditModel(
                    audio_xai_provider(self.profile_id),
                    audio_xai_model_type(self.profile_id).value,
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
    registry = audio_xai_registry()
    for key in ("models", "prospective_variants"):
        for row in cast(list[dict[str, object]], replayed[key]):
            provider, model = cast(str, row["provider"]), cast(str, row["model"])
            kind = ModelType(row["model_type"])
            selected = registry.restore_selection((provider, kind, model), row["source_variant"])
            assert isinstance(selected, (SelectedAudioSourceVariant, SelectedXAISourceVariant))
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
    endpoint: Endpoint = "official_root",
) -> _Rig:
    gateway, metadata, _, selections = setup_gateway(monkeypatch, factory)
    profile = PROFILES_BY_ID[profile_id]
    provider = audio_xai_provider(profile_id)
    plugin, provider_name = provider.rsplit("/", 1)
    uid = profile["source_plugin_uid"]
    catalog = audio_xai_catalog(profile_id)
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
    credentials = audio_xai_credentials(profile_id, endpoint)
    key = "api_key" if catalog.model_type is ModelType.LLM else "openai_api_key"
    credentials[key] = "platform-test-boundary"
    if catalog.model_type is not ModelType.LLM:
        credentials.update({"api_protocol": {"ignored": True}, "enable_request_metadata": "enabled"})
    hosting = module.ext_hosting_provider.hosting_configuration.provider_map["langgenius/openai/openai"]
    monkeypatch.setitem(
        module.ext_hosting_provider.hosting_configuration.provider_map,
        provider,
        hosting.model_copy(update={"credentials": deepcopy(credentials)}),
    )
    monkeypatch.setattr(module.dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps(audio_xai_records()))
    trace = _Trace()

    # Exercise the actual repository's tenant/provider/credential join, not a
    # fake managed_target_binding. The unrelated BYOK ciphertext is never read.
    with factory.begin() as session:
        tenant = Tenant(name="offline-audio-xai")
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
            assert contract is not None
            assert plan.plugin_unique_identifier == _TARGET_UID
            assert plan.credential_id == managed_id
            expected_profile = PROFILES_BY_ID[contract.profile_id]
            assert (requested_plugin + "/" + requested_provider, kind, model) == (
                audio_xai_provider(contract.profile_id),
                audio_xai_model_type(contract.profile_id).value,
                expected_profile["source_model"],
            )
            assert plugin_unique_identifier is None
            assert plan.operations == tuple(expected_profile["operations"])
            marker = source_parameter_marker(
                contract,
                source_provider=audio_xai_provider(contract.profile_id),
                source_model=expected_profile["source_model"],
                model_type=audio_xai_model_type(contract.profile_id),
                target_model=expected_profile["target_model"],
            )
            assert marker["profile_id"] == contract.profile_id
            assert marker["rules_digest"] == profile_digest(expected_profile)
            trace.target_calls.append(_TargetCall(contract.profile_id, plan.operations, marker))
            return trace.target_overrides.get(
                contract.profile_id, AIModelEntity.model_validate(deepcopy(expected_profile["source_daemon_schema"]))
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
        gateway, metadata, selections, trace, profile_id, endpoint, target.credential_fingerprint, deepcopy(credentials)
    )


@pytest.mark.parametrize("profile_id", _PROFILE_IDS)
def test_each_real_source_profile_requires_exact_original_uid_rpc_and_all_twenty_nine_target_handshakes(
    profile_id: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id)
    evidence = rig.collect()
    assert len(evidence.models) == 1
    assert len(evidence.prospective_variants) == 29
    assert len(rig.trace.source_calls) == 1
    call = rig.trace.source_calls[0]
    profile = PROFILES_BY_ID[profile_id]
    assert call.uid == profile["source_plugin_uid"]
    assert call.credentials == rig.system_credentials
    actual = evidence.models[0]
    assert actual["source_plugin_uid"] == profile["source_plugin_uid"]
    assert actual["source_runtime_schema_digest"] == profile["source_runtime_schema_digest"]
    assert "source_parameter_settings" not in actual
    assert "evidence" not in actual
    assert cast(dict[str, object], actual["source_variant"])["schema_version"] == (
        5 if audio_xai_model_type(profile_id) is ModelType.LLM else 4
    )
    assert rig.gateway.validate_target("tenant", REVISION, _financial_replay(evidence)) == rig.fingerprint
    expected = Counter(profile_id for profile_id, _ in SELECTOR_CASES)
    expected[profile_id] += 1
    assert Counter(call.profile_id for call in rig.trace.target_calls) == expected
    assert len(rig.trace.target_calls) == 30
    assert len(rig.trace.source_calls) == 1  # Target readiness does not run source/model calls.
    assert (
        module.ext_hosting_provider.hosting_configuration.provider_map[audio_xai_provider(profile_id)].credentials
        == rig.system_credentials
    )
    if audio_xai_model_type(profile_id) is not ModelType.LLM:
        assert "mode" not in audio_xai_catalog(profile_id).model_properties


def test_empty_free_candidate_still_requires_every_prospective_selector_without_inventing_source_evidence(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, _FAMILY_IDS[0])
    rig.selections.value = ModelDependencySelectionSnapshot((), ())
    rig.metadata.bindings.clear()
    rig.metadata.catalogs.clear()
    evidence = rig.collect(selected=False)
    assert evidence.models == ()
    assert evidence.source_ownership == {}
    assert rig.trace.source_calls == []
    assert len(evidence.prospective_variants) == 29
    assert all(row["evidence"] == "reviewed_target_profile_only" for row in evidence.prospective_variants)
    assert rig.gateway.validate_target("tenant", REVISION, _financial_replay(evidence)) == rig.fingerprint
    assert Counter(call.profile_id for call in rig.trace.target_calls) == Counter(
        profile_id for profile_id, _ in SELECTOR_CASES
    )


@pytest.mark.parametrize("profile_id", _FAMILY_IDS)
@pytest.mark.parametrize(
    "drift",
    [
        "binding_uid",
        "unverified",
        "remote",
        "catalog_uid",
        "catalog_schema",
        "catalog_duplicate",
        "runtime_none",
        "runtime_type",
        "runtime_schema",
        "endpoint",
    ],
)
def test_actual_sources_reject_fresh_installation_catalog_settings_or_runtime_drift(
    profile_id: str, drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id)
    runtime = AIModelEntity.model_validate(PROFILES_BY_ID[profile_id]["source_daemon_schema"])
    if drift == "binding_uid":
        rig.metadata.bindings[0].plugin_unique_identifier += "-changed"
    elif drift == "unverified":
        rig.metadata.bindings[0].verified = False
    elif drift == "remote":
        rig.metadata.bindings[0].source = PluginInstallationSource.Remote
    elif drift == "catalog_uid":
        rig.metadata.catalogs[0].plugin_unique_identifier += "-changed"
    elif drift == "catalog_schema":
        rig.metadata.catalogs[0].declaration.models = [
            audio_xai_catalog(profile_id).model_copy(update={"model_properties": {}})
        ]
    elif drift == "catalog_duplicate":
        rig.metadata.catalogs[0].declaration.models *= 2
    elif drift == "runtime_none":
        rig.trace.source_overrides[profile_id] = None
    elif drift == "runtime_type":
        rig.trace.source_overrides[profile_id] = runtime.model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})
    elif drift == "runtime_schema":
        rig.trace.source_overrides[profile_id] = runtime.model_copy(update={"model_properties": {}})
    else:
        hosting = module.ext_hosting_provider.hosting_configuration.provider_map[audio_xai_provider(profile_id)]
        assert hosting.credentials is not None
        hosting.credentials[
            "endpoint_url" if audio_xai_model_type(profile_id) is ModelType.LLM else "openai_api_base"
        ] = "https://unreviewed.invalid"
    with pytest.raises(ModelRouteUnavailable):
        rig.collect()
    assert rig.trace.target_calls == []


@pytest.mark.parametrize("blocked_profile", _PROFILE_IDS)
@pytest.mark.parametrize("drift", ["missing", "kind", "schema", "model"])
def test_every_prospective_profile_needs_its_own_full_runtime_handshake(
    blocked_profile: str, drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, _FAMILY_IDS[0])
    inventory = _inventory(rig.collect(selected=False))
    runtime = AIModelEntity.model_validate(PROFILES_BY_ID[blocked_profile]["source_daemon_schema"])
    if drift == "missing":
        changed = None
    elif drift == "kind":
        changed = runtime.model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})
    elif drift == "schema":
        changed = runtime.model_copy(update={"model_properties": {}})
    else:
        changed = runtime.model_copy(update={"model": "unreviewed-model"})
    rig.trace.target_overrides[blocked_profile] = changed
    with pytest.raises(ModelRouteUnmapped):
        rig.gateway.validate_target("tenant", REVISION, inventory)


@pytest.mark.parametrize("operation", _OPERATIONS)
def test_missing_required_daemon_operation_blocks_even_prospective_only_family(
    operation: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, _FAMILY_IDS[0])
    inventory = _inventory(rig.collect(selected=False))
    rig.trace.operations = tuple(value for value in _OPERATIONS if value != operation)
    with pytest.raises(ModelRouteUnavailable):
        rig.gateway.validate_target("tenant", REVISION, inventory)


@pytest.mark.parametrize("drift", ["missing", "duplicate", "registry", "profile", "runtime", "rules", "endpoint"])
def test_prospective_exact_set_and_each_frozen_selection_must_remain_bound(
    drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, _FAMILY_IDS[0])
    inventory = deepcopy(_inventory(rig.collect(selected=False)))
    rows = cast(list[dict[str, object]], inventory["prospective_variants"])
    if drift == "missing":
        rows.pop()
    elif drift == "duplicate":
        rows.append(deepcopy(rows[0]))
    elif drift == "registry":
        inventory["source_variant_registry_digest"] = "sha256:" + "0" * 64
    else:
        row = rows[0]
        selection = cast(dict[str, object], row["source_variant"])
        if drift == "profile":
            selection["variant_id"] = "unreviewed-profile"
        elif drift == "runtime":
            selection["source_runtime_schema_digest"] = "sha256:" + "0" * 64
        elif drift == "rules":
            selection["rules_digest"] = "sha256:" + "0" * 64
        else:
            settings = cast(dict[str, object], selection["source_settings"])
            assert "source_endpoint_class" in settings
            settings["source_endpoint_class"] = (
                "official_root" if settings["source_endpoint_class"] == "unset" else "unset"
            )
    with pytest.raises(ModelRouteUnavailable):
        rig.gateway.validate_target("tenant", REVISION, inventory)
    assert rig.trace.target_calls == []


@pytest.mark.parametrize("profile_id", _FAMILY_IDS)
@pytest.mark.parametrize("drift", ["uid", "catalog", "runtime", "marker", "prospective_label", "endpoint"])
def test_selected_source_attestation_cannot_be_bypassed_or_reclassified_as_prospective(
    profile_id: str, drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id)
    inventory = deepcopy(_inventory(rig.collect()))
    actual = cast(list[dict[str, object]], inventory["models"])[0]
    if drift == "uid":
        actual["source_plugin_uid"] = "unreviewed"
    elif drift in {"catalog", "runtime"}:
        actual["source_runtime_schema_digest" if drift == "runtime" else "source_schema_digest"] = "sha256:" + "0" * 64
    elif drift == "marker":
        marker = cast(dict[str, object], actual["source_parameter_contract"])
        marker["rules_digest"] = "sha256:" + "0" * 64
    elif drift == "prospective_label":
        actual["evidence"] = "reviewed_target_profile_only"
        actual.pop("source_plugin_uid")
        actual.pop("source_parameter_contract")
        actual.pop("source_runtime_schema_digest")
    else:
        selection = cast(dict[str, object], actual["source_variant"])
        if audio_xai_model_type(profile_id) is ModelType.LLM:
            selection["source_endpoint_class"] = "unset"
        else:
            cast(dict[str, object], selection["source_settings"])["source_endpoint_class"] = "unset"
    with pytest.raises(ModelRouteUnavailable):
        rig.gateway.validate_target("tenant", REVISION, inventory)


def test_catalog_or_one_kind_cannot_stand_in_for_xai_runtime_or_other_prospective_models(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    profile_id = _FAMILY_IDS[2]
    rig = _setup(monkeypatch, sqlite_session_factory, profile_id)
    evidence = rig.collect(selected=False)
    assert (
        model_schema_digest(audio_xai_catalog(profile_id)) != PROFILES_BY_ID[profile_id]["source_runtime_schema_digest"]
    )
    rig.trace.target_overrides[profile_id] = audio_xai_catalog(profile_id)
    with pytest.raises(ModelRouteUnmapped):
        rig.gateway.validate_target("tenant", REVISION, _inventory(evidence))
