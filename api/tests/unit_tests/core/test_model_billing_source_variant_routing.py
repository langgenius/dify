"""Real ProviderManager/route/admission seams for a new exact-variant revision."""

import json
from collections.abc import Iterator
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture

from core.model_invocation_routing import (
    ModelInvocationReprepare,
    ModelRouteUnmapped,
    RoutedModelCredentials,
    redirect_payload,
    validate_invocation_admission,
)
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType
from services.model_billing_mapping_service import source_mapping_revision
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.core.test_provider_manager import (
    TENANT_ID,
    ProviderCase,
    provider_case,  # noqa: F401 - register shared pytest fixture
)
from tests.unit_tests.services.test_model_billing_mapping_service import mapping, section
from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs
from tests.unit_tests.services.test_model_billing_source_variants import (
    OFFICIAL_ROOT_REVISION,
    REVISION,
    current_source_schemas,
    full_official_registry,
    full_variant_record,
    variant_record,
)


@pytest.mark.parametrize(
    ("version", "selector"),
    [("042", "absent"), ("042", "chat"), ("110", "absent"), ("110", "chat"), ("110", "responses")],
)
def test_false_preparation_full_revision_allows_fresh_official_caller_not_custom_boolean_drift(
    version: str, selector: str, variant_case: ProviderCase
) -> None:
    from services.model_billing_openai_chat_adapter import _OFFICIAL_ROOT_REVIEWED_CONTRACT as OFFICIAL042
    from services.model_billing_openai_provider110_adapter import _OFFICIAL_ROOT_REVIEWED_CONTRACTS as OFFICIAL110

    source = build_inputs(runtime=True)["source_schema"] if version == "042" else current_source_schemas()[0]
    variant_case.provider.models = [source]
    variant_case.provider.plugin_unique_identifier = (
        OFFICIAL042.source_plugin_unique_identifier
        if version == "042"
        else OFFICIAL110[0].source_plugin_unique_identifier
    )
    records = full_official_registry()
    raw = json.dumps(records)
    digest = source_mapping_revision(raw, OFFICIAL_ROOT_REVISION).digest
    variant_case.state["model_mapping_version"] = OFFICIAL_ROOT_REVISION
    variant_case.state["source_variant_registry_digest"] = digest
    preparation = variant_case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    hosting = variant_case.hosting[variant_case.provider.provider]
    hosting.credentials = {"api_key": "NEVER_FORWARD_ORIGINAL_SOURCE"}
    if selector != "absent":
        hosting.credentials["api_protocol"] = selector
    frozen_state = deepcopy(variant_case.state)

    def admit(credentials: RoutedModelCredentials) -> None:
        validate_invocation_admission(
            credentials,
            tenant_id=TENANT_ID,
            provider=variant_case.provider.provider,
            model_type=ModelType.LLM,
            model="gpt-4o-mini",
        )

    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw,
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [
                {
                    "schema_version": 1,
                    "mapping_revision": OFFICIAL_ROOT_REVISION,
                    "inventory_policy": "saved_system_dependencies_v2",
                }
            ]
        ),
    ):
        false_call = route(variant_case)
        admit(false_call)
        assert false_call.plan.mapping_revision_digest == digest
        assert false_call.plan.source_variant_binding is not None
        assert "official-root" not in false_call.plan.source_variant_binding.variant_id
        # Fresh caller-local configuration only: no global environment change,
        # no different-mode readiness/activation and no persisted settings write.
        hosting.credentials["openai_api_base"] = "https://api.openai.com"
        # Use the normal public assembly-cache owner. A genuinely separate
        # CLI process starts with this cache empty; reusing a cached False
        # configuration in this unit test would not model that caller.
        variant_case.manager.clear_configurations_cache(TENANT_ID)
        official_call = route(variant_case)
        binding = official_call.plan.source_variant_binding
        assert binding is not None
        assert binding.variant_id == "openai" + version + "-official-root-" + selector
        assert official_call.plan.mapping_revision_digest == digest
        assert official_call.plan.source_parameter_contract is not None
        assert "official-root" in official_call.plan.source_parameter_contract.profile_id
        assert official_call.plan.cache_identity != false_call.plan.cache_identity
        assert dict(official_call) == {}
        admit(official_call)
        with pytest.raises(ModelInvocationReprepare):
            admit(false_call)
        for unreviewed in (
            "https://api.openai.com/v1",
            "https://api.openai.com/",
            "https://custom.invalid",
            "https://api.openai.com?secret=NEVER_LOG",
        ):
            hosting.credentials["openai_api_base"] = unreviewed
            # Same truthy flag and plan settings digest, different endpoint
            # class: fresh pre-reserve admission must still reject it.
            assert bool(hosting.credentials["openai_api_base"])
            with pytest.raises(ModelInvocationReprepare) as denied:
                admit(official_call)
            assert "NEVER_LOG" not in str(denied.value)
        hosting.credentials["openai_api_base"] = "https://api.openai.com"
        for metadata in ("enabled", "unknown", True):
            hosting.credentials["enable_request_metadata"] = metadata
            with pytest.raises(ModelInvocationReprepare):
                admit(official_call)
        hosting.credentials.pop("enable_request_metadata")
        with config_overrides_context(
            TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([*records, mapping(revision="unrelated")])
        ):
            admit(official_call)
        changed = deepcopy(records)
        sibling_variants = changed[0]["variants"]
        assert isinstance(sibling_variants, list)
        sibling_variants.remove(
            next(
                item
                for item in sibling_variants
                if item["source_settings"]["source_base_is_set"] and item["variant_id"] != binding.variant_id
            )
        )
        with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(changed)):
            with pytest.raises(ModelInvocationReprepare):
                admit(official_call)
    assert variant_case.state == frozen_state


@pytest.fixture
def variant_case(request: pytest.FixtureRequest) -> Iterator[ProviderCase]:
    case: ProviderCase = request.getfixturevalue("provider_case")
    inputs = build_inputs(runtime=True)
    case.provider.models = [inputs["source_schema"]]
    case.provider.plugin_unique_identifier = inputs["source_plugin_unique_identifier"]
    raw = json.dumps([variant_record()])
    case.state["model_mapping_version"] = REVISION
    case.state["source_variant_registry_digest"] = source_mapping_revision(raw, REVISION).digest
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw,
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [{"schema_version": 1, "mapping_revision": REVISION, "inventory_policy": "saved_system_dependencies_v2"}]
        ),
    ):
        yield case


def route(case: ProviderCase) -> RoutedModelCredentials:
    configuration = case.manager.get_configurations(TENANT_ID).get(case.provider.provider)
    assert configuration is not None
    assert configuration.system_configuration.credentials is None
    result = configuration.get_current_credentials(ModelType.LLM, "gpt-4o-mini")
    assert isinstance(result, RoutedModelCredentials)
    return result


def test_pure_historical_v1_cache_bytes_remain_frozen_without_new_revision_evidence() -> None:
    from tests.unit_tests.core.test_model_invocation_routing import plan

    historical = plan()
    assert historical.mapping_revision_digest is None
    assert historical.source_variant_binding is None
    assert historical.cache_identity == "7fefb684f4f3ab4e0e2ce95820d880446b1fcece6922acc79ea051687c330158"


@pytest.mark.parametrize("selector", ["absent", "chat"])
def test_new_revision_routes_real_source_and_admits_same_frozen_variant(
    selector: str, variant_case: ProviderCase
) -> None:
    hosting = variant_case.hosting[variant_case.provider.provider]
    hosting.credentials = {"api_key": "NEVER_FORWARD_SOURCE", "api_protocol": None if selector == "absent" else "chat"}
    credentials = route(variant_case)
    binding = credentials.plan.source_variant_binding
    assert binding is not None
    assert binding.variant_id == "openai042-" + selector
    assert binding.registry_digest == variant_case.state["source_variant_registry_digest"]
    assert credentials.plan.mapping_revision_digest == binding.registry_digest
    validate_invocation_admission(
        credentials,
        tenant_id=TENANT_ID,
        provider=variant_case.provider.provider,
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
    )
    assert credentials.plan.source_parameter_contract is not None
    assert credentials.plan.source_parameter_contract.source_runtime_schema_digest == (
        "sha256:b068793d31c93e11b44e31374e24f62ce25b7c8744aae708213f7caa41be4783"
    )
    assert credentials.plan.cache_identity != replace(credentials.plan, source_variant_binding=None).cache_identity


@pytest.mark.parametrize("missing", ["variant", "contract", "revision", "all", "variant_id", "target", "operations"])
def test_v2_authority_cannot_be_downgraded_by_dropping_optional_plan_evidence(
    missing: str, variant_case: ProviderCase
) -> None:
    credentials = route(variant_case)
    original = credentials.plan
    if missing == "variant":
        changed = replace(original, source_variant_binding=None)
    elif missing == "contract":
        changed = replace(original, source_parameter_contract=None)
    elif missing == "revision":
        changed = replace(original, mapping_revision_digest=None)
    elif missing == "all":
        changed = replace(
            original, source_variant_binding=None, source_parameter_contract=None, mapping_revision_digest=None
        )
    elif missing == "variant_id":
        assert original.source_variant_binding is not None
        changed = replace(original, source_variant_binding=replace(original.source_variant_binding, variant_id="wrong"))
    elif missing == "target":
        changed = replace(original, target_model="wrong")
    else:
        changed = replace(original, operations=("model/schema",))
    with pytest.raises(ModelInvocationReprepare):
        validate_invocation_admission(
            RoutedModelCredentials(changed),
            tenant_id=TENANT_ID,
            provider=changed.logical_provider,
            model_type=changed.model_type,
            model=changed.logical_model,
        )


def test_mixed_v1_embedding_in_v2_revision_has_revision_pin_without_a_variant(
    variant_case: ProviderCase,
) -> None:
    from tests.unit_tests.services.test_model_billing_mapping_service import schema

    embedding = schema("text-embedding-3-small", ModelType.TEXT_EMBEDDING)
    variant_case.provider.models.append(embedding)
    variant_case.provider.supported_model_types = [
        *variant_case.provider.supported_model_types,
        ModelType.TEXT_EMBEDDING,
    ]
    records = [variant_record(), mapping(embedding, revision=REVISION, target="text-embedding-3-small")]
    raw = json.dumps(records)
    digest = source_mapping_revision(raw, REVISION).digest
    variant_case.state["source_variant_registry_digest"] = digest
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=raw):
        config = variant_case.manager.get_configurations(TENANT_ID).get(variant_case.provider.provider)
        assert config is not None
        credentials = config.get_current_credentials(ModelType.TEXT_EMBEDDING, embedding.model)
        assert isinstance(credentials, RoutedModelCredentials)
        assert credentials.plan.mapping_revision_digest == digest
        assert credentials.plan.source_variant_binding is None
        assert credentials.plan.source_parameter_contract is None
        validate_invocation_admission(
            credentials,
            tenant_id=TENANT_ID,
            provider=credentials.plan.logical_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=embedding.model,
        )
        with pytest.raises(ModelInvocationReprepare):
            validate_invocation_admission(
                RoutedModelCredentials(replace(credentials.plan, mapping_revision_digest=None)),
                tenant_id=TENANT_ID,
                provider=credentials.plan.logical_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=embedding.model,
            )
        records[1] = mapping(embedding, revision=REVISION, target="changed-embedding-target")
        with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(records)):
            with pytest.raises(ModelInvocationReprepare):
                validate_invocation_admission(
                    credentials,
                    tenant_id=TENANT_ID,
                    provider=credentials.plan.logical_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=embedding.model,
                )


@pytest.mark.parametrize("family", ["anthropic", "tts"])
@pytest.mark.parametrize("change", ["valid", "missing", "rules", "target"])
def test_mixed_nonidentity_v1_sibling_requires_exact_source_adapter_evidence(
    family: str, change: str, variant_case: ProviderCase
) -> None:
    from tests.unit_tests.services.test_model_billing_mapping_service import section

    original = route(variant_case).plan
    if family == "anthropic":
        from tests.unit_tests.services.test_model_billing_anthropic_adapter import contract_for, model_mapping

        source_contract = contract_for()
        tts_contract = None
        sibling = model_mapping().model_dump(mode="json")
    else:
        from tests.unit_tests.services.test_model_billing_tts_adapter import contract_for as tts_for
        from tests.unit_tests.services.test_model_billing_tts_adapter import source_schema

        tts_contract = tts_for()
        source_contract = None
        sibling = mapping(source_schema(), target="openai/gpt-4o-mini-tts-2025-12-15")
        sibling["parameter_adapter"] = {
            "id": tts_contract.adapter_id,
            "revision": tts_contract.algorithm_revision,
            "rules_digest": tts_contract.rules_digest,
        }
    sibling["mapping_revision"] = REVISION
    raw = json.dumps([variant_record(), sibling])
    digest = source_mapping_revision(raw, REVISION).digest
    variant_case.state["source_variant_registry_digest"] = digest
    source = section(sibling, "source")
    target = section(sibling, "target")
    assert isinstance(source["provider_id"], str)
    assert isinstance(source["model"], str)
    assert isinstance(target["model"], str)
    operations = sibling["operations"]
    assert isinstance(operations, list)
    frozen = replace(
        original,
        logical_provider=source["provider_id"],
        logical_model=source["model"],
        model_type=ModelType(source["model_type"]),
        target_model=target["model"],
        operations=tuple(operations),
        source_variant_binding=None,
        mapping_revision_digest=digest,
        source_parameter_contract=source_contract,
        tts_voice_contract=tts_contract,
    )
    if change == "missing":
        frozen = replace(frozen, source_parameter_contract=None, tts_voice_contract=None)
    elif change == "rules":
        if source_contract is not None:
            frozen = replace(
                frozen, source_parameter_contract=replace(source_contract, rules_digest="sha256:" + "f" * 64)
            )
        elif tts_contract is not None:
            frozen = replace(frozen, tts_voice_contract=replace(tts_contract, rules_digest="sha256:" + "f" * 64))
    elif change == "target":
        frozen = replace(frozen, target_model="wrong-target")
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=raw):
        if change == "valid":
            validate_invocation_admission(
                RoutedModelCredentials(frozen),
                tenant_id=TENANT_ID,
                provider=frozen.logical_provider,
                model_type=frozen.model_type,
                model=frozen.logical_model,
            )
        else:
            with pytest.raises(ModelInvocationReprepare):
                validate_invocation_admission(
                    RoutedModelCredentials(frozen),
                    tenant_id=TENANT_ID,
                    provider=frozen.logical_provider,
                    model_type=frozen.model_type,
                    model=frozen.logical_model,
                )


@pytest.mark.parametrize("selector", ["absent", "responses", "chat"])
def test_late_installed_current_source_selects_its_own_default_not_frozen042_chat(
    selector: str, variant_case: ProviderCase
) -> None:
    from services.model_billing_openai_provider110_adapter import _REVIEWED_CONTRACTS

    source, _runtime = current_source_schemas()
    variant_case.provider.models = [source]
    variant_case.provider.plugin_unique_identifier = _REVIEWED_CONTRACTS[0].source_plugin_unique_identifier
    hosting = variant_case.hosting[variant_case.provider.provider]
    hosting.credentials = {"api_key": "NEVER_FORWARD_CURRENT_SOURCE"}
    if selector != "absent":
        hosting.credentials["api_protocol"] = selector
    raw = json.dumps([full_variant_record()])
    variant_case.state["source_variant_registry_digest"] = source_mapping_revision(raw, REVISION).digest
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=raw):
        credentials = route(variant_case)
        assert credentials.plan.source_parameter_contract == _REVIEWED_CONTRACTS[0 if selector == "chat" else 1]
        binding = credentials.plan.source_variant_binding
        assert binding is not None
        assert binding.variant_id == "openai110-" + selector
        validate_invocation_admission(
            credentials,
            tenant_id=TENANT_ID,
            provider=variant_case.provider.provider,
            model_type=ModelType.LLM,
            model="gpt-4o-mini",
        )


@pytest.mark.parametrize(
    "change", ["pin_missing", "pin_wrong", "policy_missing", "fact_missing", "fact_uid", "fact_catalog"]
)
def test_route_does_not_reconstruct_missing_or_mismatched_new_authority(
    change: str, variant_case: ProviderCase
) -> None:
    if change == "pin_missing":
        variant_case.state.pop("source_variant_registry_digest")
    elif change == "pin_wrong":
        variant_case.state["source_variant_registry_digest"] = "sha256:" + "f" * 64
    configuration = variant_case.manager.get_configurations(TENANT_ID).get(variant_case.provider.provider)
    assert configuration is not None
    fact = configuration.system_configuration._tokener_source_variant_fact
    assert fact is not None
    if change == "fact_missing":
        configuration.system_configuration._tokener_source_variant_fact = None
    elif change == "fact_uid":
        configuration.system_configuration._tokener_source_variant_fact = replace(
            fact, plugin_unique_identifier="wrong"
        )
    elif change == "fact_catalog":
        configuration.system_configuration._tokener_source_variant_fact = replace(fact, catalog_schema_digests=())
    with config_overrides_context(
        **({"TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON": "[]"} if change == "policy_missing" else {})
    ):
        with pytest.raises(ModelRouteUnmapped):
            configuration.get_current_credentials(ModelType.LLM, "gpt-4o-mini")


@pytest.mark.parametrize("change", ["registry", "pin", "protocol", "base", "metadata", "whole_settings"])
def test_before_reservation_rechecks_current_and_persisted_variant_pin(change: str, variant_case: ProviderCase) -> None:
    credentials = route(variant_case)
    hosting = variant_case.hosting[variant_case.provider.provider]
    assert hosting.credentials is not None
    if change == "pin":
        variant_case.state["source_variant_registry_digest"] = "sha256:" + "f" * 64
    elif change == "protocol":
        hosting.credentials["api_protocol"] = "chat"
    elif change == "base":
        hosting.credentials["openai_api_base"] = "https://never-export.invalid"
    elif change == "metadata":
        hosting.credentials["enable_request_metadata"] = "enabled"
    elif change == "whole_settings":
        variant_case.hosting[variant_case.provider.provider] = hosting.model_copy(update={"credentials": None})
    raw = variant_record()
    if change == "registry":
        raw["pool_types"] = ["paid"]
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([raw])):
        with pytest.raises(ModelInvocationReprepare):
            validate_invocation_admission(
                credentials,
                tenant_id=TENANT_ID,
                provider=variant_case.provider.provider,
                model_type=ModelType.LLM,
                model="gpt-4o-mini",
            )


@pytest.mark.parametrize("change", ["uid", "protocol", "base", "metadata", "whole_settings"])
def test_invalid_shared_variant_is_quarantined_without_losing_real_byok(
    change: str, variant_case: ProviderCase
) -> None:
    hosting = variant_case.hosting[variant_case.provider.provider]
    assert hosting.credentials is not None
    if change == "uid":
        variant_case.provider.plugin_unique_identifier = "langgenius/openai:9.9.9@" + "a" * 64
    elif change == "protocol":
        hosting.credentials["api_protocol"] = "responses"
    elif change == "base":
        hosting.credentials["openai_api_base"] = "https://never-export.invalid"
    elif change == "metadata":
        hosting.credentials["enable_request_metadata"] = "enabled"
    else:
        variant_case.hosting[variant_case.provider.provider] = hosting.model_copy(update={"credentials": None})
    variant_case.preferences[variant_case.provider.provider] = SimpleNamespace(
        preferred_provider_type=ProviderType.CUSTOM
    )
    configuration = variant_case.manager.get_configurations(TENANT_ID).get(variant_case.provider.provider)
    assert configuration is not None
    assert not configuration.system_configuration.enabled
    assert configuration.using_provider_type == ProviderType.CUSTOM
    assert configuration.get_current_credentials(ModelType.LLM, "gpt-4o-mini") == {"api_key": "USER_SECRET"}


@pytest.mark.parametrize("flag", ["source_base_is_set", "request_metadata_enabled"])
def test_unreviewed_true_flag_row_matching_actual_settings_still_keeps_byok(
    flag: str, variant_case: ProviderCase
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import variants

    record = variant_record()
    for row in variants(record):
        section(row, "source_settings")[flag] = True
    hosting = variant_case.hosting[variant_case.provider.provider]
    assert hosting.credentials is not None
    if flag == "source_base_is_set":
        hosting.credentials["openai_api_base"] = "https://private.invalid"
    else:
        hosting.credentials["enable_request_metadata"] = "enabled"
    variant_case.preferences[variant_case.provider.provider] = SimpleNamespace(
        preferred_provider_type=ProviderType.CUSTOM
    )
    raw = json.dumps([record])
    variant_case.state["source_variant_registry_digest"] = source_mapping_revision(raw, REVISION).digest
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=raw):
        configuration = variant_case.manager.get_configurations(TENANT_ID).get(variant_case.provider.provider)
        assert configuration is not None
        assert not configuration.system_configuration.enabled
        assert configuration.using_provider_type == ProviderType.CUSTOM
        assert configuration.get_current_credentials(ModelType.LLM, "gpt-4o-mini") == {"api_key": "USER_SECRET"}


def test_already_frozen_dispatch_does_not_reenter_changed_admission(
    variant_case: ProviderCase, mocker: MockerFixture
) -> None:
    import core.model_invocation_routing as routing

    credentials = route(variant_case)
    variant_case.state["source_variant_registry_digest"] = "sha256:" + "f" * 64
    admission = mocker.spy(routing, "validate_invocation_admission")
    mocker.patch.object(routing, "managed_credentials", return_value={"api_key": "MANAGED_TEST_KEY"})
    payload = redirect_payload(credentials.plan, {"provider": "openai", "model": "gpt-4o-mini", "model_type": "llm"})
    assert payload["target"]["credentials"]["api_key"] == "MANAGED_TEST_KEY"
    assert payload["target"]["credentials"]["_dify_source_contract"]["profile_id"] == (
        "openai-042-chat-runtime-v2:gpt-4o-mini"
    )
    admission.assert_not_called()


def test_unrelated_revision_append_does_not_invalidate_existing_variant_admission(variant_case: ProviderCase) -> None:
    credentials = route(variant_case)
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([variant_record(), mapping(revision="unrelated-valid-revision")])
    ):
        validate_invocation_admission(
            credentials,
            tenant_id=TENANT_ID,
            provider=variant_case.provider.provider,
            model_type=ModelType.LLM,
            model="gpt-4o-mini",
        )
