"""Exact installed JSON declaration; fake only the existing daemon owners."""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from core.dify_builder.models import Graph
from core.plugin.entities.plugin import PluginInstallation
from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, QualifiedJsonToolBinding
from services.dify_builder import json_tool_metadata as metadata

TENANT = "tenant-1"
FIXTURE = Path(__file__).parent / "fixtures/json_parse_static_provider.json"


def _provider(**changes: object) -> PluginToolProviderEntity:
    return PluginToolProviderEntity.model_validate(
        {
            "provider": metadata.NATIVE_PROVIDER_NAME,
            "plugin_id": metadata.PLUGIN_ID,
            "plugin_unique_identifier": metadata.UNIQUE_IDENTIFIER,
            "declaration": json.loads(FIXTURE.read_text()),
            **changes,
        }
    )


def _installation(**changes: object) -> PluginInstallation:
    now = datetime(2026, 10, 12, tzinfo=UTC)
    return PluginInstallation.model_validate(
        {
            "id": "installation-1",
            "created_at": now,
            "updated_at": now,
            "tenant_id": TENANT,
            "endpoints_setups": 0,
            "endpoints_active": 0,
            "runtime_type": "local",
            "source": "marketplace",
            "meta": {},
            "plugin_id": metadata.PLUGIN_ID,
            "plugin_unique_identifier": metadata.UNIQUE_IDENTIFIER,
            "version": metadata.VERSION,
            "checksum": metadata.CHECKSUM,
            "declaration": {
                "version": metadata.VERSION,
                "author": "langgenius",
                "name": "json_process",
                "description": {"en_US": "JSON Process"},
                "icon": "icon.svg",
                "label": {"en_US": "JSON Process"},
                "created_at": now,
                "resource": {"memory": 1},
                "plugins": {},
                "meta": {},
            },
            **changes,
        }
    )


def _owners(
    monkeypatch: pytest.MonkeyPatch,
    installations: list[PluginInstallation] | None = None,
    provider: object | None = None,
    error: Exception | None = None,
) -> list[tuple[str, str, list[str] | str]]:
    calls: list[tuple[str, str, list[str] | str]] = []

    class Installer:
        def fetch_plugin_installation_by_ids(self, tenant_id: str, plugin_ids: list[str]) -> list[PluginInstallation]:
            calls.append(("install", tenant_id, plugin_ids))
            if error:
                raise error
            return [_installation()] if installations is None else installations

    class Manager:
        def fetch_tool_provider(self, tenant_id: str, provider_id: str) -> object:
            calls.append(("provider", tenant_id, provider_id))
            if error:
                raise error
            return _provider() if provider is None else provider

    monkeypatch.setattr(metadata, "PluginInstaller", Installer)
    monkeypatch.setattr(metadata, "PluginToolManager", Manager)
    return calls


def _expected(actual: metadata.InstalledJsonParse) -> QualifiedJsonToolBinding:
    return QualifiedJsonToolBinding(
        node_id="node2",
        **{field: getattr(actual, field) for field in actual.__dataclass_fields__},
        final_parameters_digest="a" * 64,
    )


def test_reviewed_normalized_declaration_matches_frozen_digests(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _owners(monkeypatch)
    actual = metadata.resolve_installed_json_parse(tenant_id=TENANT)
    assert actual.provider_schema_digest == metadata.PROVIDER_SCHEMA_DIGEST
    assert actual.tool_schema_digest == metadata.TOOL_SCHEMA_DIGEST
    assert actual.qualification_digest == metadata.QUALIFICATION_DIGEST
    assert actual.qualification_digest == "ee2a3bf69cf28644c0f34b7bcef8281fdc5da29a7b64914a6759583943c13e59"
    assert calls == [
        ("install", TENANT, [metadata.PLUGIN_ID]),
        ("provider", TENANT, metadata.PROVIDER_ID),
    ]
    metadata.require_same_json_installation(_expected(actual), actual)


@pytest.mark.parametrize("count", [0, 2])
def test_zero_or_multiple_installations_refuse(monkeypatch: pytest.MonkeyPatch, count: int) -> None:
    _owners(monkeypatch, installations=[_installation()] * count)
    with pytest.raises(BuilderExecutionPolicyError, match="installed_json_tool_unavailable"):
        metadata.resolve_installed_json_parse(tenant_id=TENANT)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", "other"),
        ("plugin_id", "other"),
        ("plugin_unique_identifier", "other"),
        ("version", "0.0.9"),
        ("checksum", "f" * 64),
        ("runtime_type", "serverless"),
        pytest.param("runtime_type", "", id="runtime_type-empty"),
        pytest.param("runtime_type", "Local", id="runtime_type-case-local"),
        pytest.param("runtime_type", "SERVERLESS", id="runtime_type-case-serverless"),
        pytest.param("runtime_type", "unknown", id="runtime_type-unknown"),
        ("source", "remote"),
    ],
)
def test_installation_identity_or_runtime_drift_refuses(
    monkeypatch: pytest.MonkeyPatch, field: str, value: str
) -> None:
    _owners(monkeypatch, installations=[_installation(**{field: value})])
    if field == "runtime_type" and value == "serverless":
        actual = metadata.resolve_installed_json_parse(tenant_id=TENANT)
        local = replace(actual, runtime_type="local", qualification_digest=metadata.QUALIFICATION_DIGEST)
        with pytest.raises(BuilderExecutionPolicyError, match="json_tool_installation_changed"):
            metadata.require_same_json_installation(_expected(local), actual)
        return
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_json_tool_installation"):
        metadata.resolve_installed_json_parse(tenant_id=TENANT)


@pytest.mark.parametrize("field", ["provider", "plugin_id", "plugin_unique_identifier"])
def test_provider_identity_drift_refuses(monkeypatch: pytest.MonkeyPatch, field: str) -> None:
    _owners(monkeypatch, provider=_provider(**{field: "other"}))
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_json_tool_installation"):
        metadata.resolve_installed_json_parse(tenant_id=TENANT)


@pytest.mark.parametrize(
    ("mutation", "value"),
    [
        ("credential", [{"name": "secret", "type": "secret-input"}]),
        ("oauth", {"client_schema": [], "credentials_schema": []}),
        ("dynamic", True),
        ("output", {"type": "object"}),
        ("default", False),
    ],
)
def test_schema_credential_oauth_dynamic_or_default_drift_refuses(
    monkeypatch: pytest.MonkeyPatch, mutation: str, value: Graph | bool | list[Graph]
) -> None:
    provider = _provider().model_dump(mode="json")
    declaration = provider["declaration"]
    if mutation == "credential":
        declaration["credentials_schema"] = value
    elif mutation == "oauth":
        declaration["oauth_schema"] = value
    elif mutation == "dynamic":
        declaration["tools"][0]["has_runtime_parameters"] = value
    elif mutation == "output":
        declaration["tools"][0]["output_schema"] = value
    else:
        declaration["tools"][0]["parameters"][2]["default"] = value
    _owners(monkeypatch, provider=PluginToolProviderEntity.model_validate(provider))
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_json_tool_installation"):
        metadata.resolve_installed_json_parse(tenant_id=TENANT)


def test_transport_failure_is_sanitized(monkeypatch: pytest.MonkeyPatch) -> None:
    _owners(monkeypatch, error=RuntimeError("private daemon response"))
    with pytest.raises(BuilderExecutionPolicyError) as exc:
        metadata.resolve_installed_json_parse(tenant_id=TENANT)
    assert "private daemon response" not in str(exc.value)


def test_malformed_native_response_is_sanitized(monkeypatch: pytest.MonkeyPatch) -> None:
    _owners(monkeypatch, provider={"error": "private validation detail"})
    with pytest.raises(BuilderExecutionPolicyError) as exc:
        metadata.resolve_installed_json_parse(tenant_id=TENANT)
    assert "private validation detail" not in str(exc.value)


def test_persisted_binding_drift_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    _owners(monkeypatch)
    actual = metadata.resolve_installed_json_parse(tenant_id=TENANT)
    expected = _expected(actual).model_copy(update={"installation_id": "other"})
    with pytest.raises(BuilderExecutionPolicyError, match="json_tool_installation_changed"):
        metadata.require_same_json_installation(expected, actual)


def test_qualified_serverless_installation_persists_its_own_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    _owners(monkeypatch, installations=[_installation(runtime_type="serverless")])

    actual = metadata.resolve_installed_json_parse(tenant_id=TENANT)

    assert actual.runtime_type == "serverless"
    assert actual.qualification_digest == "b3728bbec6b6fcb4c9bd4677fb519994ebd4666c182c542a8acd0c0e5ef89c03"
    assert actual.qualification_digest != metadata.QUALIFICATION_DIGEST
    expected = _expected(actual)
    assert expected.runtime_type == "serverless"
    assert expected.qualification_digest == actual.qualification_digest
    metadata.require_same_json_installation(expected, actual)


def test_qualified_serverless_binding_preserves_runtime_and_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    _owners(monkeypatch)
    local = metadata.resolve_installed_json_parse(tenant_id=TENANT)
    serverless = replace(
        local,
        runtime_type="serverless",
        qualification_digest="b3728bbec6b6fcb4c9bd4677fb519994ebd4666c182c542a8acd0c0e5ef89c03",
    )

    expected = _expected(serverless)

    assert expected.runtime_type == "serverless"
    assert expected.qualification_digest == serverless.qualification_digest
    metadata.require_same_json_installation(expected, serverless)


@pytest.mark.parametrize(
    "changed",
    ["runtime_type", "qualification_digest"],
)
def test_cross_variant_expected_binding_drift_refuses(monkeypatch: pytest.MonkeyPatch, changed: str) -> None:
    _owners(monkeypatch)
    local = metadata.resolve_installed_json_parse(tenant_id=TENANT)
    expected = _expected(local)
    serverless = replace(
        local,
        runtime_type="serverless",
        qualification_digest="b3728bbec6b6fcb4c9bd4677fb519994ebd4666c182c542a8acd0c0e5ef89c03",
    )
    actual = serverless
    if changed == "qualification_digest":
        actual = replace(local, qualification_digest=serverless.qualification_digest)

    with pytest.raises(BuilderExecutionPolicyError, match="json_tool_installation_changed"):
        metadata.require_same_json_installation(expected, actual)
